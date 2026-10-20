import {
  ApplicationStateMachine,
  InvalidStateTransitionException,
} from './application-state-machine';
import { ApplicationStatus, ReviewDecision } from './application-status.enum';

describe('ApplicationStateMachine', () => {
  it.each([
    [ApplicationStatus.DRAFT, ApplicationStatus.SUBMITTED],
    [ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW],
    [ApplicationStatus.UNDER_REVIEW, ApplicationStatus.APPROVED],
    [ApplicationStatus.UNDER_REVIEW, ApplicationStatus.REJECTED],
    [ApplicationStatus.UNDER_REVIEW, ApplicationStatus.INFO_REQUESTED],
    [ApplicationStatus.INFO_REQUESTED, ApplicationStatus.SUBMITTED],
  ])('allows %s -> %s', (from, to) => {
    expect(() => ApplicationStateMachine.assertTransition(from, to)).not.toThrow();
  });

  it.each([
    [ApplicationStatus.DRAFT, ApplicationStatus.APPROVED],
    [ApplicationStatus.SUBMITTED, ApplicationStatus.APPROVED],
    [ApplicationStatus.APPROVED, ApplicationStatus.REJECTED],
    [ApplicationStatus.REJECTED, ApplicationStatus.SUBMITTED],
    [ApplicationStatus.APPROVED, ApplicationStatus.SUBMITTED],
    [ApplicationStatus.UNDER_REVIEW, ApplicationStatus.SUBMITTED],
  ])('rejects %s -> %s', (from, to) => {
    expect(() => ApplicationStateMachine.assertTransition(from, to)).toThrow(
      InvalidStateTransitionException,
    );
  });

  it('only allows edits in draft or info requested', () => {
    const editable = Object.values(ApplicationStatus).filter(ApplicationStateMachine.isEditable);
    expect(editable).toEqual([ApplicationStatus.DRAFT, ApplicationStatus.INFO_REQUESTED]);
  });

  it('does not allow assigning drafts or decided applications', () => {
    expect(ApplicationStateMachine.isAssignable(ApplicationStatus.DRAFT)).toBe(false);
    expect(ApplicationStateMachine.isAssignable(ApplicationStatus.APPROVED)).toBe(false);
    expect(ApplicationStateMachine.isAssignable(ApplicationStatus.REJECTED)).toBe(false);
    expect(ApplicationStateMachine.isAssignable(ApplicationStatus.SUBMITTED)).toBe(true);
  });

  it('maps decisions to target statuses', () => {
    expect(ApplicationStateMachine.targetFor(ReviewDecision.APPROVE)).toBe(
      ApplicationStatus.APPROVED,
    );
    expect(ApplicationStateMachine.targetFor(ReviewDecision.REJECT)).toBe(
      ApplicationStatus.REJECTED,
    );
    expect(ApplicationStateMachine.targetFor(ReviewDecision.REQUEST_INFO)).toBe(
      ApplicationStatus.INFO_REQUESTED,
    );
  });
});
