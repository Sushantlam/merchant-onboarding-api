import { maskTaxId } from '../../common/utils/sensitive-data';
import { ApplicationStatus, BusinessType, RiskStatus } from '../domain/application-status.enum';
import { MerchantApplication } from '../merchant-application.entity';

export class ApplicationResponseDto {
  id: string;
  businessName: string;
  legalBusinessName: string;
  businessType: BusinessType;
  taxIdMasked: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  monthlyVolume: number;
  averageTicket: number;
  merchantCategoryCode: string;
  status: ApplicationStatus;
  riskStatus: RiskStatus;
  riskScore: number | null;
  decisionNote: string | null;
  createdById: string;
  assignedReviewerId: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  static from(application: MerchantApplication): ApplicationResponseDto {
    return {
      id: application.id,
      businessName: application.businessName,
      legalBusinessName: application.legalBusinessName,
      businessType: application.businessType,
      taxIdMasked: maskTaxId(application.taxId),
      ownerName: application.ownerName,
      ownerEmail: application.ownerEmail,
      ownerPhone: application.ownerPhone,
      monthlyVolume: application.monthlyVolume,
      averageTicket: application.averageTicket,
      merchantCategoryCode: application.merchantCategoryCode,
      status: application.status,
      riskStatus: application.riskStatus,
      riskScore: application.riskScore,
      decisionNote: application.decisionNote,
      createdById: application.createdById,
      assignedReviewerId: application.assignedReviewerId,
      submittedAt: application.submittedAt,
      decidedAt: application.decidedAt,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    };
  }
}

export class PaginatedApplicationsDto {
  data: ApplicationResponseDto[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
