import { Role } from '../../users/role.enum';
import { MerchantApplication } from '../merchant-application.entity';
import { ApplicationAccessPolicy } from './application-access.policy';

describe('ApplicationAccessPolicy', () => {
  const policy = new ApplicationAccessPolicy();
  const admin = { id: 'admin-1', email: 'a@example.com', role: Role.ADMIN };
  const owner = { id: 'sales-1', email: 's1@example.com', role: Role.SALES };
  const otherSales = { id: 'sales-2', email: 's2@example.com', role: Role.SALES };
  const reviewer = { id: 'reviewer-1', email: 'r1@example.com', role: Role.REVIEWER };
  const otherReviewer = { id: 'reviewer-2', email: 'r2@example.com', role: Role.REVIEWER };

  const application = {
    id: 'app-1',
    createdById: owner.id,
    assignedReviewerId: reviewer.id,
  } as MerchantApplication;

  it('lets sales users see only their own applications', () => {
    expect(policy.canView(owner, application)).toBe(true);
    expect(policy.canView(otherSales, application)).toBe(false);
    expect(policy.scopeFor(otherSales)).toEqual({ createdById: otherSales.id });
  });

  it('lets reviewers see only applications assigned to them', () => {
    expect(policy.canView(reviewer, application)).toBe(true);
    expect(policy.canView(otherReviewer, application)).toBe(false);
    expect(policy.scopeFor(reviewer)).toEqual({ assignedReviewerId: reviewer.id });
  });

  it('gives admins unrestricted read access', () => {
    expect(policy.canView(admin, application)).toBe(true);
    expect(policy.scopeFor(admin)).toEqual({});
  });

  it('allows editing only by the creator or an admin', () => {
    expect(policy.canEdit(owner, application)).toBe(true);
    expect(policy.canEdit(admin, application)).toBe(true);
    expect(policy.canEdit(otherSales, application)).toBe(false);
    expect(policy.canEdit(reviewer, application)).toBe(false);
  });

  it('allows decisions only by the assigned reviewer', () => {
    expect(policy.canDecide(reviewer, application)).toBe(true);
    expect(policy.canDecide(otherReviewer, application)).toBe(false);
    expect(policy.canDecide(admin, application)).toBe(false);
    expect(policy.canDecide(owner, application)).toBe(false);
  });

  it('does not let a reviewer decide an unassigned application', () => {
    const unassigned = { ...application, assignedReviewerId: null } as MerchantApplication;
    expect(policy.canDecide(reviewer, unassigned)).toBe(false);
  });
});
