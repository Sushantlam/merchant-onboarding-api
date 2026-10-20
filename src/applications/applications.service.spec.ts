import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { Role } from '../users/role.enum';
import { User } from '../users/user.entity';
import { OutboxService } from '../outbox/outbox.service';
import { ApplicationsService } from './applications.service';
import { MerchantApplication } from './merchant-application.entity';
import { ApplicationAccessPolicy } from './domain/application-access.policy';
import { ApplicationStatus, ReviewDecision, RiskStatus } from './domain/application-status.enum';

describe('ApplicationsService', () => {
  const admin = { id: 'admin-1', email: 'admin@example.com', role: Role.ADMIN };
  const sales = { id: 'sales-1', email: 'sales@example.com', role: Role.SALES };
  const reviewer = { id: 'reviewer-1', email: 'reviewer@example.com', role: Role.REVIEWER };

  let stored: MerchantApplication;
  let audit: { record: jest.Mock };
  let outbox: { add: jest.Mock };
  let usersService: { findById: jest.Mock };
  let service: ApplicationsService;

  const buildApplication = (overrides: Partial<MerchantApplication> = {}) =>
    ({
      id: 'app-1',
      businessName: 'Corner Cafe',
      createdById: sales.id,
      assignedReviewerId: reviewer.id,
      status: ApplicationStatus.UNDER_REVIEW,
      riskStatus: RiskStatus.LOW,
      submissionCount: 1,
      decisionNote: null,
      ...overrides,
    }) as MerchantApplication;

  beforeEach(() => {
    stored = buildApplication();
    audit = { record: jest.fn() };
    outbox = { add: jest.fn() };
    usersService = { findById: jest.fn() };

    const manager = {
      findOne: jest.fn(async () => (stored ? { ...stored } : null)),
      save: jest.fn(async (entity: MerchantApplication) => (stored = { ...entity })),
      merge: jest.fn((_type, target, source) => Object.assign(target, source)),
    };
    const dataSource = {
      transaction: jest.fn((work: (m: typeof manager) => unknown) => work(manager)),
    };

    service = new ApplicationsService(
      {} as Repository<MerchantApplication>,
      dataSource as unknown as DataSource,
      new ApplicationAccessPolicy(),
      audit as unknown as AuditService,
      usersService as unknown as UsersService,
      outbox as unknown as OutboxService,
    );
  });

  describe('decide', () => {
    it('approves an application for the assigned reviewer', async () => {
      const result = await service.decide(reviewer, 'app-1', { decision: ReviewDecision.APPROVE });

      expect(result.status).toBe(ApplicationStatus.APPROVED);
      expect(result.decidedAt).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REVIEW_DECISION_RECORDED', actorId: reviewer.id }),
        expect.anything(),
      );
    });

    it('requires a note when rejecting', async () => {
      await expect(
        service.decide(reviewer, 'app-1', { decision: ReviewDecision.REJECT }),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires a justification to approve a high risk application', async () => {
      stored = buildApplication({ riskStatus: RiskStatus.HIGH });

      await expect(
        service.decide(reviewer, 'app-1', { decision: ReviewDecision.APPROVE }),
      ).rejects.toThrow('high risk');

      const result = await service.decide(reviewer, 'app-1', {
        decision: ReviewDecision.APPROVE,
        note: 'Volumes verified against bank statements',
      });
      expect(result.status).toBe(ApplicationStatus.APPROVED);
    });

    it('moves to info requested and keeps the application undecided', async () => {
      const result = await service.decide(reviewer, 'app-1', {
        decision: ReviewDecision.REQUEST_INFO,
        note: 'Please upload proof of address',
      });
      expect(result.status).toBe(ApplicationStatus.INFO_REQUESTED);
      expect(result.decidedAt).toBeNull();
    });

    it('blocks decisions before the risk review has finished', async () => {
      stored = buildApplication({ status: ApplicationStatus.SUBMITTED });
      await expect(
        service.decide(reviewer, 'app-1', { decision: ReviewDecision.APPROVE }),
      ).rejects.toThrow(ConflictException);
    });

    it('blocks a second decision on a decided application', async () => {
      stored = buildApplication({ status: ApplicationStatus.REJECTED });
      await expect(
        service.decide(reviewer, 'app-1', { decision: ReviewDecision.APPROVE }),
      ).rejects.toThrow(ConflictException);
    });

    it('hides the application from a reviewer who is not assigned', async () => {
      const other = { ...reviewer, id: 'reviewer-2' };
      await expect(
        service.decide(other, 'app-1', { decision: ReviewDecision.APPROVE }),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not let admins record decisions', async () => {
      await expect(
        service.decide(admin, 'app-1', { decision: ReviewDecision.APPROVE }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('submit', () => {
    it('submits a draft and records a risk review request in the outbox', async () => {
      stored = buildApplication({ status: ApplicationStatus.DRAFT, submissionCount: 0 });

      const result = await service.submit(sales, 'app-1');

      expect(result.status).toBe(ApplicationStatus.SUBMITTED);
      expect(result.riskStatus).toBe(RiskStatus.PENDING);
      expect(outbox.add).toHaveBeenCalledWith(expect.anything(), 'RISK_REVIEW_REQUESTED', {
        applicationId: 'app-1',
        submissionNumber: 1,
      });
    });

    it('increments the submission number on resubmission', async () => {
      stored = buildApplication({ status: ApplicationStatus.INFO_REQUESTED, submissionCount: 1 });

      await service.submit(sales, 'app-1');

      expect(outbox.add).toHaveBeenCalledWith(expect.anything(), 'RISK_REVIEW_REQUESTED', {
        applicationId: 'app-1',
        submissionNumber: 2,
      });
    });

    it('does not submit an application twice', async () => {
      stored = buildApplication({ status: ApplicationStatus.SUBMITTED });
      await expect(service.submit(sales, 'app-1')).rejects.toThrow(ConflictException);
      expect(outbox.add).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects edits once the application has been submitted', async () => {
      stored = buildApplication({ status: ApplicationStatus.UNDER_REVIEW });
      await expect(service.update(sales, 'app-1', { businessName: 'New name' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('records which fields changed without their values', async () => {
      stored = buildApplication({ status: ApplicationStatus.DRAFT });

      await service.update(sales, 'app-1', { businessName: 'New name', taxId: '98-7654321' });

      const [entry] = audit.record.mock.calls[0];
      expect(entry.metadata).toEqual({ changedFields: ['businessName', 'taxId'] });
    });
  });

  describe('retryRiskReview', () => {
    it('queues a retry for a failed check', async () => {
      stored = buildApplication({
        status: ApplicationStatus.SUBMITTED,
        riskStatus: RiskStatus.FAILED,
      });

      const result = await service.retryRiskReview(admin, 'app-1');

      expect(result.riskStatus).toBe(RiskStatus.PENDING);
      expect(outbox.add).toHaveBeenCalledWith(expect.anything(), 'RISK_REVIEW_RETRY_REQUESTED', {
        applicationId: 'app-1',
        submissionNumber: 1,
      });
    });

    it('refuses to retry a completed check', async () => {
      await expect(service.retryRiskReview(admin, 'app-1')).rejects.toThrow(ConflictException);
      expect(outbox.add).not.toHaveBeenCalled();
    });
  });

  describe('assignReviewer', () => {
    it('rejects assigning a user who is not a reviewer', async () => {
      usersService.findById.mockResolvedValue({ id: 'sales-2', role: Role.SALES, isActive: true });
      await expect(service.assignReviewer(admin, 'app-1', 'sales-2')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects assigning a draft application', async () => {
      stored = buildApplication({ status: ApplicationStatus.DRAFT, assignedReviewerId: null });
      usersService.findById.mockResolvedValue({
        id: 'reviewer-2',
        role: Role.REVIEWER,
        isActive: true,
      } as User);
      await expect(service.assignReviewer(admin, 'app-1', 'reviewer-2')).rejects.toThrow(
        ConflictException,
      );
    });

    it('records the previous reviewer when reassigning', async () => {
      usersService.findById.mockResolvedValue({
        id: 'reviewer-2',
        role: Role.REVIEWER,
        isActive: true,
      } as User);

      const result = await service.assignReviewer(admin, 'app-1', 'reviewer-2');

      expect(result.assignedReviewerId).toBe('reviewer-2');
      expect(audit.record.mock.calls[0][0].metadata).toEqual({
        reviewerId: 'reviewer-2',
        previousReviewerId: reviewer.id,
      });
    });
  });
});
