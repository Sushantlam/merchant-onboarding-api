export const RISK_PROVIDER = Symbol('RISK_PROVIDER');

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RiskAssessmentRequest {
  idempotencyKey: string;
  legalBusinessName: string;
  taxId: string;
  merchantCategoryCode: string;
  monthlyVolume: number;
  averageTicket: number;
}

export interface RiskAssessment {
  providerReference: string;
  score: number;
  level: RiskLevel;
  reasons: string[];
}

export interface RiskProvider {
  assess(request: RiskAssessmentRequest): Promise<RiskAssessment>;
}

export class RiskProviderUnavailableError extends Error {
  constructor(message = 'Risk provider is temporarily unavailable') {
    super(message);
    this.name = 'RiskProviderUnavailableError';
  }
}
