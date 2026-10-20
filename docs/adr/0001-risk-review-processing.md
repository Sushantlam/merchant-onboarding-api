# ADR 0001: Risk review processing

Status: Accepted

## Context

Submitting a merchant application needs a risk/KYB check from a third party. Those providers are slow, rate limited and fail intermittently. The submit request shouldn't wait on them, a provider or Redis outage shouldn't lose submissions, and retries shouldn't create duplicate results.

## Decision

- Submitting changes the application to `SUBMITTED` and writes an `outbox_events` row in the same DB transaction. The HTTP response is `202 Accepted`. The API process never touches the job queue.
- A separate worker process (`src/worker.ts`) runs an outbox relay and the BullMQ processor. The relay polls pending events with `FOR UPDATE SKIP LOCKED`, enqueues them, and marks them processed. Failed enqueues back off exponentially.
- The job id is derived from `(applicationId, submissionNumber)`. Each resubmission (after `INFO_REQUESTED`) gets a new submission number, so a new check, while duplicates of the same submission collapse into one job.
- Results are stored in `risk_checks` with a unique constraint on `(application_id, submission_number)`. The insert, the application update and the audit entry happen in one transaction. The application update is conditional on the status and submission number still matching.
- BullMQ handles provider retries with exponential backoff. After the final attempt the application is marked `risk_status = FAILED` and an admin can request a retry, which also goes through the outbox.
- The provider sits behind a `RiskProvider` interface injected with a token, so the simulated provider can be swapped for a real one (or a test double) without touching the worker.

## Alternatives considered

- **Synchronous call in the request.** Simplest, but ties API latency and availability to the provider.
- **Enqueue directly after commit.** Fewer moving parts, but if Redis is unavailable between the commit and the enqueue, the submission is silently stuck. That was the first version; the outbox replaced it.
- **Postgres-based queue (e.g. pg-boss).** Would make enqueue transactional for free, but the brief asks for Redis + BullMQ.
- **CDC (Debezium / logical replication) instead of polling.** Lower latency, but a lot of infrastructure for one event type.

## Consequences

- No submission can be lost between Postgres and Redis. If the worker is down, work queues up in the outbox and is picked up when it comes back.
- Delivery is at-least-once, so the consumer must be idempotent. It is, through the job id, the unique constraint and the conditional update.
- The API and worker scale independently and can be deployed separately from the same image.
- Up to one poll interval (1 s by default) of extra latency before a job is enqueued.
