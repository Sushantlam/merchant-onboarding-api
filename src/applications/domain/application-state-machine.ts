import { ConflictException } from '@nestjs/common';
import { ApplicationStatus, ReviewDecision } from './application-status.enum';

const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  [ApplicationStatus.DRAFT]: [ApplicationStatus.SUBMITTED],
  [ApplicationStatus.SUBMITTED]: [ApplicationStatus.UNDER_REVIEW],
  [ApplicationStatus.UNDER_REVIEW]: [
    ApplicationStatus.APPROVED,
    ApplicationStatus.REJECTED,
    ApplicationStatus.INFO_REQUESTED,
  ],
  [ApplicationStatus.INFO_REQUESTED]: [ApplicationStatus.SUBMITTED],
  [ApplicationStatus.APPROVED]: [],
  [ApplicationStatus.REJECTED]: [],
};

const EDITABLE = [ApplicationStatus.DRAFT, ApplicationStatus.INFO_REQUESTED];

const ASSIGNABLE = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.INFO_REQUESTED,
];

const DECISION_TARGET: Record<ReviewDecision, ApplicationStatus> = {
  [ReviewDecision.APPROVE]: ApplicationStatus.APPROVED,
  [ReviewDecision.REJECT]: ApplicationStatus.REJECTED,
  [ReviewDecision.REQUEST_INFO]: ApplicationStatus.INFO_REQUESTED,
};

export class InvalidStateTransitionException extends ConflictException {
  constructor(from: ApplicationStatus, to: ApplicationStatus) {
    super(`Cannot move application from ${from} to ${to}`);
  }
}

export const ApplicationStateMachine = {
  canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
    return TRANSITIONS[from].includes(to);
  },

  assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
    if (!this.canTransition(from, to)) throw new InvalidStateTransitionException(from, to);
  },

  isEditable(status: ApplicationStatus): boolean {
    return EDITABLE.includes(status);
  },

  isAssignable(status: ApplicationStatus): boolean {
    return ASSIGNABLE.includes(status);
  },

  targetFor(decision: ReviewDecision): ApplicationStatus {
    return DECISION_TARGET[decision];
  },
};
