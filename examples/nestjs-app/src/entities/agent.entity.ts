import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { TenantColumn } from 'nest-warden/typeorm';

@Entity('agents')
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'tenant_id' })
  @TenantColumn()
  tenantId!: string;

  @Column('text')
  email!: string;

  @Column('text')
  name!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
