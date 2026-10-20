import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { RiskStatus } from '../applications/domain/application-status.enum';

@Entity('risk_checks')
@Unique('uq_risk_checks_application_submission', ['applicationId', 'submissionNumber'])
export class RiskCheck {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  @Column({ name: 'submission_number', type: 'int' })
  submissionNumber: number;

  @Column({ name: 'provider_reference' })
  providerReference: string;

  @Column({ type: 'int' })
  score: number;

  @Column({ type: 'varchar' })
  outcome: RiskStatus;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  reasons: string[];

  @Column({ type: 'int' })
  attempts: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
