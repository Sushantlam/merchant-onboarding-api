export const RISK_REVIEW_QUEUE = 'risk-review';
export const RISK_REVIEW_JOB = 'assess-application';

export interface RiskReviewJobData {
  applicationId: string;
  submissionNumber: number;
}

export function riskReviewJobId(data: RiskReviewJobData): string {
  return `risk-${data.applicationId}-${data.submissionNumber}`;
}
