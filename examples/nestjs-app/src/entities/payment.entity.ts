import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { TenantColumn } from 'nest-warden/typeorm';

export type PaymentStatus = 'pending' | 'authorized' | 'captured' | 'refunded';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'tenant_id' })
  @TenantColumn()
  tenantId!: string;

  @Column('uuid', { name: 'merchant_id' })
  merchantId!: string;

  @Column('bigint', { name: 'amount_cents', transformer: { from: (v: string) => Number(v), to: (v: number) => v } })
  amountCents!: number;

  @Column('text')
  status!: PaymentStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
