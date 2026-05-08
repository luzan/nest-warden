import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { TenantColumn } from 'nest-warden/typeorm';

@Entity('agent_merchant_assignments')
export class AgentMerchantAssignment {
  @PrimaryColumn('uuid', { name: 'agent_id' })
  agentId!: string;

  @PrimaryColumn('uuid', { name: 'merchant_id' })
  merchantId!: string;

  @Column('uuid', { name: 'tenant_id' })
  @TenantColumn()
  tenantId!: string;

  @CreateDateColumn({ name: 'assigned_at' })
  assignedAt!: Date;
}
