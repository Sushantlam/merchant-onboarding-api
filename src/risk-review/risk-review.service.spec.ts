import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { MerchantApplication } from '../applications/merchant-application.entity';
import { ApplicationStatus } from '../applications/domain/application-status.enum';
import { RiskProvider } from './provider/risk-provider';
import { RiskReviewService } from './risk-review.service';

describe('RiskReviewService', () => {
  const job = { applicationId: 'app-1', submissionNumber: 2 };

  let applications: { findOne: jest.Mock };
  let provider: { assess: jest.Mock };
  let audit: { record: jest.Mock };
  let insertResult: { raw: unknown[] };
  let updateResult: { affected: number };
  let service: RiskReviewService;

  const queryBuilder = () => {
    const builder: Record<string, jest.Mock> = {};
    for (const method of [
      'insert',
      'into',
      'values',
      'orIgnore',
      'returning',
      'update',
      'set',
      'where',
      'andWhere',
    ]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.execute = jest.fn(async () =>
      builder.insert.mock.calls.length ? insertResult : updateResult,
    );
    return builder;
  };

  beforeEach(() => {
    applications = { findOne: jest.fn() };
    provider = {
      assess: jest.fn().mockResolvedValue({
        providerReference: 'sim_abc',
        score: 55,
        level: 'MEDIUM',
        reasons: ['HIGH_MONTHLY_VOLUME'],
      }),
    };
    audit = { record: jest.fn() };
    insertResult = { raw: [{ id: 'check-1' }] };
    updateResult = { affected: 1 };

    const manager = { createQueryBuilder: jest.fn(queryBuilder) };
    const dataSource = {
      transaction: jest.fn((work: (m: typeof manager) => unknown) => work(manager)),
    };

    service = new RiskReviewService(
      applications as unknown as Repository<MerchantApplication>,
      provider as RiskProvider,
      audit as unknown as AuditService,
      dataSource as unknown as DataSource,
    );
  });

  const awaiting = (overrides: Partial<MerchantApplication> = {}) =>
    ({
      id: 'app-1',
      status: ApplicationStatus.SUBMITTED,
      submissionCount: 2,
      taxId: '12-3456789',
      ...overrides,
    }) as MerchantApplication;

  it('stores the assessment and records an audit entry', async () => {
    applications.findOne.mockResolvedValue(awaiting());

    await expect(service.process(job, 1)).resolves.toBe('COMPLETED');
    expect(provider.assess).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'app-1:2' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RISK_REVIEW_COMPLETED', actorId: null }),
      expect.anything(),
    );
  });

  it('skips jobs for an older submission without calling the provider', async () => {
    applications.findOne.mockResolvedValue(awaiting({ submissionCount: 3 }));

    await expect(service.process(job, 1)).resolves.toBe('SKIPPED');
    expect(provider.assess).not.toHaveBeenCalled();
  });

  it('skips jobs once the application has left the submitted state', async () => {
    applications.findOne.mockResolvedValue(awaiting({ status: ApplicationStatus.UNDER_REVIEW }));

    await expect(service.process(job, 1)).resolves.toBe('SKIPPED');
    expect(provider.assess).not.toHaveBeenCalled();
  });

  it('skips when the application no longer exists', async () => {
    applications.findOne.mockResolvedValue(null);
    await expect(service.process(job, 1)).resolves.toBe('SKIPPED');
  });

  it('is a no-op when the risk check was already stored by another run', async () => {
    applications.findOne.mockResolvedValue(awaiting());
    insertResult = { raw: [] };

    await expect(service.process(job, 2)).resolves.toBe('SKIPPED');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lets provider errors bubble up so the queue can retry', async () => {
    applications.findOne.mockResolvedValue(awaiting());
    provider.assess.mockRejectedValue(new Error('timeout'));

    await expect(service.process(job, 1)).rejects.toThrow('timeout');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('marks the check as failed only while the submission is still pending', async () => {
    await service.markFailed(job, 'timeout');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RISK_REVIEW_FAILED' }),
      expect.anything(),
    );

    audit.record.mockClear();
    updateResult = { affected: 0 };
    await service.markFailed(job, 'timeout');
    expect(audit.record).not.toHaveBeenCalled();
  });
});
