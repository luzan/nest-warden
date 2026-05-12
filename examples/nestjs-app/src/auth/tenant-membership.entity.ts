import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * One row per (user, tenant) pair. `roles` is the array of role names
 * the user holds in this tenant; names must exist in the application's
 * `permission-registry.ts` system roles or in the tenant's
 * `custom_roles` table.
 *
 * The JWT guard's only job at the auth layer is to verify token
 * signature + freshness and then look up THIS row. If no row exists
 * for `(jwt.sub, jwt.tenantId)`, the request is rejected with 403 —
 * because a valid token whose subject has no membership in the
 * claimed tenant is exactly the "tampered claim" failure mode the
 * trust-boundary check is designed to catch.
 */
@Entity('tenant_memberships')
export class TenantMembership {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId!: string;

  @PrimaryColumn('uuid', { name: 'tenant_id' })
  tenantId!: string;

  @Column('jsonb')
  roles!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
