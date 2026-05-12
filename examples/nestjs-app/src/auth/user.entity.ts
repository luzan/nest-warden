import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Tenant-agnostic identity. A row here is what a JWT's `sub` claim
 * resolves to — the durable record of "who is this person at all,"
 * independent of which tenant they're currently acting as. The
 * per-tenant role grant lives on `TenantMembership`.
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('text', { unique: true })
  email!: string;

  @Column('text')
  name!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
