import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { encryptedColumn } from '../common/crypto/field-encryption';
import { ApplicationStatus, BusinessType, RiskStatus } from './domain/application-status.enum';

const decimal = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : Number(value)),
};

@Entity('merchant_applications')
export class MerchantApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'business_name' })
  businessName: string;

  @Column({ name: 'legal_business_name' })
  legalBusinessName: string;

  @Column({ name: 'business_type', type: 'varchar' })
  businessType: BusinessType;

  @Column({ name: 'tax_id', type: 'text', transformer: encryptedColumn })
  taxId: string;

  @Column({ name: 'owner_name', type: 'text', transformer: encryptedColumn })
  ownerName: string;

  @Column({ name: 'owner_email', type: 'text', transformer: encryptedColumn })
  ownerEmail: string;

  @Column({ name: 'owner_phone', type: 'text', transformer: encryptedColumn })
  ownerPhone: string;

  @Column({
    name: 'monthly_volume',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: decimal,
  })
  monthlyVolume: number;

  @Column({
    name: 'average_ticket',
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: decimal,
  })
  averageTicket: number;

  @Column({ name: 'merchant_category_code', length: 4 })
  merchantCategoryCode: string;

  @Column({ type: 'varchar', default: ApplicationStatus.DRAFT })
  status: ApplicationStatus;

  @Column({ name: 'risk_status', type: 'varchar', default: RiskStatus.NOT_STARTED })
  riskStatus: RiskStatus;

  @Column({ name: 'risk_score', type: 'int', nullable: true })
  riskScore: number | null;

  @Column({ name: 'submission_count', type: 'int', default: 0 })
  submissionCount: number;

  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decisionNote: string | null;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @Column({ name: 'assigned_reviewer_id', type: 'uuid', nullable: true })
  assignedReviewerId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assigned_reviewer_id' })
  assignedReviewer: User | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
