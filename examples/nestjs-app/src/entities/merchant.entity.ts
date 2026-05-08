import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TenantColumn } from 'nest-warden/typeorm';

export type MerchantStatus = 'active' | 'pending' | 'closed';

@Entity('merchants')
export class Merchant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'tenant_id' })
  @TenantColumn()
  tenantId!: string;

  @Column('text')
  name!: string;

  @Column('text')
  status!: MerchantStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  // Soft-delete marker. TypeORM treats this column specially: any
  // QueryBuilder or Repository read auto-applies `WHERE deletedAt
  // IS NULL` unless you opt in via `.withDeleted()`. Calling
  // `repo.softRemove(entity)` sets the column instead of issuing
  // a DELETE statement.
  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date | null;
}
