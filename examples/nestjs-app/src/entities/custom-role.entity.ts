import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { TenantColumn } from 'nest-warden/typeorm';

/**
 * Tenant-managed custom roles loaded at request time via
 * `loadCustomRoles` (RFC 001 Phase C). Each row pairs a role name
 * with a JSONB array of permission references.
 *
 * The `permissions` column stores permission *names*, not rule
 * shapes — the application's permission registry resolves the
 * names to `(action, subject, conditions, fields)` tuples on the
 * library side. Storing names keeps the table schema stable as
 * the application's rules evolve.
 */
@Entity('custom_roles')
@Unique(['tenantId', 'name'])
export class CustomRole {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'tenant_id' })
  @TenantColumn()
  tenantId!: string;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  description?: string | null;

  @Column('jsonb')
  permissions!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
