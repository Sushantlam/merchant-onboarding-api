# Merchant Onboarding API

NestJS service for onboarding merchants onto a payments platform. Sales staff create merchant applications, submitting one kicks off an asynchronous risk/KYB check, and an assigned reviewer makes the final call. Every significant action ends up in an audit trail.

## Stack

- NestJS 10, TypeScript (strict)
- PostgreSQL 16 + TypeORM 0.3 (hand-written migrations, `synchronize` off)
- Redis 7 + BullMQ for the risk review queue; Redis also backs rate limiting and session revocation
- JWT auth, role guard + object-level policy
- Swagger at `/docs`
- Jest (unit) and Supertest (integration against real Postgres/Redis)
- Docker Compose for local infra

## Running locally

```bash
cp .env.example .env
# fill in:
#   DB_PASSWORD    anything, e.g. openssl rand -hex 16
#   JWT_SECRET     32+ chars, e.g. openssl rand -hex 32
#   SEED_PASSWORD  12+ chars

npm install
npm run keys:generate      # prints the three FIELD_ENCRYPTION_* lines, paste them into .env

docker compose up -d postgres redis
npm run migration:run
npm run seed
npm run start:dev          # API
npm run start:worker:dev   # risk review worker + outbox relay, in a second terminal
```

The API and the worker are separate processes. The API never touches the job queue; it writes submissions to Postgres and the worker takes it from there. (The API does use Redis for rate limiting and revoked sessions.) Submitting without the worker running is fine, the application just stays `PENDING` until the worker starts and picks it up.

Keep `FIELD_ENCRYPTION_MASTER_KEY` safe. If it's lost, the data keys can't be unwrapped and the encrypted columns can't be read back.

Swagger UI: http://localhost:3000/docs

The seed creates five users, all with the password from `SEED_PASSWORD`:

| Email | Role |
| --- | --- |
| admin@example.com | ADMIN |
| reviewer@example.com | REVIEWER |
| reviewer2@example.com | REVIEWER |
| sales@example.com | SALES |
| sales2@example.com | SALES |

To run the API and worker in containers as well: `docker compose --profile app up --build`. The API container runs migrations before starting, and the worker uses the same image with `node dist/worker`.

## Tests

```bash
npm test             # unit tests, no infra needed
npm run test:e2e     # needs postgres + redis from docker compose
```

The integration tests use a separate `merchant_onboarding_test` database (created by `docker/postgres-init.sql` on first start of the postgres container). Each suite runs migrations, truncates the tables, clears its Redis keys, and generates a random JWT secret and encryption keys at runtime, so nothing secret lives in the repo. The test app boots the API and the worker modules together so the full submit → outbox → queue → worker path runs for real. Tests use their own Redis prefixes (`QUEUE_PREFIX=test`, `REDIS_KEY_PREFIX=test-app:`), so a dev worker running at the same time won't steal test jobs.

If your postgres volume existed before the init script was added, create the test database by hand:

```bash
docker compose exec postgres createdb -U merchant merchant_onboarding_test
```

## API overview

| Method | Path | Who |
| --- | --- | --- |
| POST | `/auth/login` | public, rate limited |
| POST | `/auth/refresh` | public, needs a valid refresh token |
| POST | `/auth/logout` | public, needs a valid refresh token |
| GET | `/auth/me` | any authenticated user |
| POST | `/users` | ADMIN |
| GET | `/users?role=` | ADMIN |
| POST | `/applications` | SALES, ADMIN |
| GET | `/applications?status=&page=&limit=` | scoped per role |
| GET | `/applications/:id` | scoped per role |
| PATCH | `/applications/:id` | creator (SALES) or ADMIN, while editable |
| POST | `/applications/:id/submit` | creator (SALES) or ADMIN |
| POST | `/applications/:id/assign` | ADMIN |
| POST | `/applications/:id/decision` | assigned REVIEWER only |
| POST | `/applications/:id/risk-review/retry` | ADMIN |
| GET | `/applications/:id/audit` | ADMIN, assigned REVIEWER |

Errors always come back in the same shape:

```json
{ "statusCode": 409, "error": "CONFLICT", "message": "Cannot move application from APPROVED to REJECTED", "path": "/applications/...", "timestamp": "..." }
```

## Domain

### Lifecycle

```
DRAFT ──submit──▶ SUBMITTED ──risk check done──▶ UNDER_REVIEW ──▶ APPROVED
                     ▲                                │      └──▶ REJECTED
                     │                                ▼
                     └────────submit────────── INFO_REQUESTED
```

- An application is editable only in `DRAFT` and `INFO_REQUESTED`.
- `SUBMITTED → UNDER_REVIEW` is only done by the worker, never through the API.
- A reviewer can only decide when the application is `UNDER_REVIEW`, so a decision can't be made before the risk result is in.
- Rejecting or requesting info needs a note. Approving a `HIGH` risk application also needs a note (the justification).
- `APPROVED` and `REJECTED` are terminal.
- Assignment is possible in `SUBMITTED`, `UNDER_REVIEW` and `INFO_REQUESTED`. Reassignment is allowed and the previous reviewer is recorded in the audit log.

All transitions live in `src/applications/domain/application-state-machine.ts`, which is plain code with no Nest or DB dependencies so it's easy to unit test.

### Authorization

Two layers:

1. **Role guard** (`@Roles(...)`) – coarse check per route. A REVIEWER can't hit `POST /applications` at all.
2. **Object-level policy** (`ApplicationAccessPolicy`) – checked against the loaded row, inside the same transaction that changes it.

| Role | Can see | Can change |
| --- | --- | --- |
| ADMIN | everything | edit, submit, assign, retry risk review. Cannot record decisions. |
| SALES | only applications they created | only their own, only while editable |
| REVIEWER | only applications assigned to them | decision, only when assigned |

The list endpoint uses the same policy to build its `WHERE` clause, so there's one place deciding visibility. If a user can't see an application they get a **404**, not a 403, so ids of other users' applications can't be probed. If they can see it but aren't allowed to do the action, they get a 403.

The spec says only the assigned reviewer may record a decision, so I took that literally and admins can't either. An admin can assign the work but not approve it, which keeps a four-eyes split between operations and risk.

### Async risk review

`POST /applications/:id/submit` does everything in one transaction:

1. Locks the row (`SELECT ... FOR UPDATE`), checks policy + transition.
2. Sets `SUBMITTED` / `PENDING`, increments `submission_count`.
3. Writes the audit entry.
4. Writes an `outbox_events` row `RISK_REVIEW_REQUESTED { applicationId, submissionNumber }`.

Either all of that commits or none of it does, so a submission can never be lost between the database and Redis.

The worker process runs two things:

**Outbox relay** (`OutboxRelay`) polls `outbox_events` every second with `SELECT ... FOR UPDATE SKIP LOCKED` (so several workers can run without picking the same row), pushes each event onto BullMQ with `jobId = risk-<id>-<submission>`, and marks it processed. If Redis is down the event stays put with `attempts`, `last_error` and an exponential `available_at` backoff capped at a minute.

**Risk processor** (`RiskReviewProcessor` → `RiskReviewService`):

1. Loads the application. If it's no longer `SUBMITTED` or the submission number doesn't match, the job is stale and is skipped without calling the provider.
2. Calls the risk provider (`RiskProvider` interface; `SimulatedRiskProvider` is the only implementation). The provider gets an idempotency key of `<id>:<submission>` the way a real KYB vendor would.
3. In one transaction: inserts into `risk_checks` with `ON CONFLICT DO NOTHING` on `(application_id, submission_number)`, then does a conditional `UPDATE ... WHERE status = 'SUBMITTED' AND submission_count = :n`, then writes the audit entry. If the insert hits the conflict, the run is a no-op.

The outbox is at-least-once (if the worker dies after enqueuing but before marking the row processed, the event is relayed again), so the consumer has to be idempotent. That comes from three places, so any one of them failing doesn't cause a double write:

- deterministic `jobId` – BullMQ won't add a second job with the same id while the first exists
- unique `(application_id, submission_number)` in `risk_checks`
- conditional update on status + submission number

Retries: configurable attempts (default 4) with exponential backoff. When the last attempt fails the application gets `risk_status = FAILED` (status stays `SUBMITTED`) and an audit entry. An admin can then call `/risk-review/retry`, which writes a `RISK_REVIEW_RETRY_REQUESTED` outbox event; the relay re-runs the failed BullMQ job or enqueues a fresh one.

The simulated provider is deterministic for the same input (score is derived from a hash of the tax id plus rules on MCC, volume and ticket size) and fails randomly based on `RISK_PROVIDER_FAILURE_RATE` so retries can be seen locally.

### Data model

- `users` – email (unique), bcrypt hash (cost 12, never selected by default), role
- `merchant_applications` – business, owner and processing info, status, risk status/score, `submission_count`, assigned reviewer, timestamps, `version`
- `risk_checks` – one row per submission, unique on `(application_id, submission_number)`
- `audit_logs` – action, entity, actor, `jsonb` metadata, indexed on `(entity_type, entity_id)`
- `outbox_events` – pending work for the worker, partial index on `available_at WHERE processed_at IS NULL`
- `refresh_tokens` – SHA-256 hash of each refresh token, its family, expiry, revocation and what replaced it

Statuses are `varchar` + `CHECK` constraints rather than Postgres enums, because altering enum types in migrations is painful and the check gives the same protection. Money is `numeric`, never float. Indexes match the queries the API actually runs: by creator, by reviewer, and by status, all ordered by `created_at`.

## Sensitive data

- Passwords are bcrypt hashed. Login runs a bcrypt compare even for unknown emails so response time doesn't reveal which emails exist.
- Login is rate limited to 5 attempts per minute per IP + email (`@nestjs/throttler`, returns 429). Keying on the email as well means one office behind a NAT doesn't lock everyone out, while a single account still can't be brute forced. Refresh and logout allow 30 per minute per IP. Counters live in Redis (`RedisThrottlerStorage`, one atomic Lua script per hit), so the limit holds across any number of API instances.
- Access tokens are short-lived JWTs (15 min). Refresh tokens are 48 random bytes, opaque, and only their SHA-256 hash is stored. Every refresh rotates the token. If an already-used refresh token is presented again, the whole token family is revoked, which is the standard signal that a token was stolen. A deactivated user can't refresh.
- Each login is a session. The session id is the refresh token family id and is carried in the access token as `sid`. Logout, or detected refresh token reuse, revokes the session in Postgres and also writes `auth:revoked-session:<sid>` to Redis with a TTL equal to the access token lifetime. The auth guard checks that key on every request, so an access token stops working immediately instead of living out its 15 minutes. Once the TTL passes, any access token for that session would have expired anyway, so Redis never accumulates entries. If Redis is unreachable the guard fails closed with a 503 rather than letting a possibly-revoked token through.
- Tokens, passwords and request bodies are never logged. The request logger writes method, path, status, duration and user id only.
- The tax id is never returned by the API; responses carry `taxIdMasked` (`******6789`).
- Audit metadata goes through `redact()` before it's stored, which replaces known sensitive keys (password, token, authorization, taxId, owner email/phone, ...) at any depth. Updates record only the names of changed fields, not values.
- `ValidationPipe` runs with `whitelist` + `forbidNonWhitelisted`, so a client can't sneak in `createdById`, `status`, `assignedReviewerId` etc.

### Field-level encryption

These columns are encrypted at the application layer with AES-256-GCM through a TypeORM column transformer (`src/common/crypto/field-encryption.ts`):

| Column | Why |
| --- | --- |
| `merchant_applications.tax_id` | government identifier (EIN/UTR/SSN for sole traders) |
| `merchant_applications.owner_email` | personal data of the beneficial owner |
| `merchant_applications.owner_phone` | personal data of the beneficial owner |
| `merchant_applications.owner_name` | personal data, especially for sole proprietors |

Each value gets a fresh random IV and is stored as `v1:<key id>:<iv>.<auth tag>.<ciphertext>`. GCM's auth tag means a tampered value fails to decrypt instead of returning garbage. The second migration encrypts any existing plaintext rows (and decrypts them again on revert), so it's safe to run against a database that already has data.

**Envelope encryption.** Data is never encrypted with the master key directly:

- `FIELD_ENCRYPTION_DATA_KEYS` holds one or more data keys, each *wrapped* (encrypted) by the master key: `k1:<wrapped>,k2:<wrapped>`.
- At startup the app unwraps them through a `KeyWrapper` and keeps the plaintext data keys in memory only.
- `FIELD_ENCRYPTION_ACTIVE_KEY_ID` picks the key used for new writes. Older keys stay in the list so existing values can still be read; every value records which key encrypted it.

`KeyWrapper` is a two-method interface (`wrap`, `unwrap`). The included `LocalKeyWrapper` uses a master key from `FIELD_ENCRYPTION_MASTER_KEY`, which stands in for a KMS here. In production you'd add a `KmsKeyWrapper` whose `unwrap` calls the cloud KMS decrypt API, so the master key never leaves the KMS and the environment only contains wrapped keys that are useless on their own. Only `createKeyWrapper` would change.

**Rotating a key:**

```bash
npm run keys:generate k2     # with the current master key in .env; prints the keyring with k2 appended and k2 active
# update FIELD_ENCRYPTION_DATA_KEYS / FIELD_ENCRYPTION_ACTIVE_KEY_ID, restart the API and worker
npm run keys:reencrypt       # rewrites every row still on an old key (or still plaintext); safe to re-run
# once it reports 0, the old key can be removed from FIELD_ENCRYPTION_DATA_KEYS
```

Encrypted columns can't be searched or indexed; if duplicate-merchant detection by tax id is needed, store an HMAC of it next to the ciphertext. Bank account details aren't modelled here but would go in the same bucket, ideally tokenised by a vault rather than stored at all.

## Trade-offs and things I'd do next

- **Polling outbox relay** rather than logical replication / Debezium. A one-second poll on a partial index is cheap and has no extra infrastructure. Processed rows are kept for now; a nightly cleanup job would delete old ones.
- **A Redis lookup on every authenticated request** for session revocation. It's a single `EXISTS` and keeps logout honest; the cost is that Redis becomes a hard dependency of the API (it fails closed with 503).
- **No real KMS adapter.** Envelope encryption and rotation are in place, but the master key is local. Writing the KMS-backed `KeyWrapper` is one small class plus credentials, and I didn't want to ship code I couldn't run here.
- **Re-encryption is a script, not a background job.** It's batched and idempotent, which is enough for this data size.
- **Pessimistic row locks** for every state change. Simple and correct for low contention. The `version` column is there if we want optimistic locking with `If-Match` headers later.
- **Audit log in Postgres**, written in the same transaction as the change, so an action and its audit entry can't diverge. It's append-only by convention; in production I'd revoke `UPDATE/DELETE` on the table from the app role.
- **No webhook / MongoDB** optional parts – I focused on the core.

See [docs/adr/0001-risk-review-processing.md](docs/adr/0001-risk-review-processing.md) for the reasoning behind the queue design.

## Project layout

```
src/
  applications/        controller, service, DTOs, entity
    domain/            state machine, access policy, enums
  risk-review/         BullMQ producer + processor, risk check entity
    provider/          RiskProvider interface + simulated implementation
  outbox/              outbox entity, writer (API side) and relay (worker side)
  audit/               audit log entity + service
  auth/                login, refresh/logout, session revocation, Redis rate limiting, JWT module
  users/               user entity, admin endpoints
  redis/               shared Redis client for the API
  common/              guards, decorators, exception filter, logging interceptor, redaction
    crypto/            AES-GCM helpers, key wrapper, keyring, column transformer
  database/            data source, migrations, seed, re-encryption
  scripts/             key generation and re-encryption CLIs
  main.ts              API entry point (AppModule)
  worker.ts            worker entry point (WorkerModule)
test/                  Supertest integration suites
```

## AI usage disclosure

<!-- Fill this in honestly before submitting: which tools you used, for what, and how you verified the output. -->
