import type { EntitySubscriberInterface, InsertEvent, UpdateEvent } from 'typeorm';
import { getTenantColumn } from './tenant-column.decorator.js';
import type { TenantIdValue } from '../core/tenant-id.js';

/**
 * Function signature for the per-event tenant resolver. Returns the
 * canonical tenant ID for the request that triggered this insert/update,
 * or `undefined` when there's no tenant context (system jobs, migrations).
 *
 * The function MUST be sync — TypeORM subscribers are synchronous in v0.3,
 * and the resolver is invoked inside the entity-write hot path.
 */
export type TenantResolver = () => TenantIdValue | undefined;

/**
 * Renders a value for inclusion in error messages. Tenant column values are
 * always scalars in valid usage (string/number); but defensive code may
 * encounter unexpected shapes (objects, arrays). Render them as JSON to
 * avoid the unhelpful `'[object Object]'` default.
 */
function safeFormat(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  /* c8 ignore next */
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * TypeORM `EntitySubscriberInterface` that auto-stamps the tenant column
 * on every insert and verifies it stays consistent on every update.
 *
 * Behavior:
 *
 *   - **beforeInsert**: if the entity has a `@TenantColumn` and that
 *     column is empty/undefined on the new row, stamp it with the value
 *     returned by `tenantResolver()`. If the column is already set to
 *     something OTHER than the resolved tenant, throw a
 *     `Cross-tenant insert` error — defense against forged inputs.
 *
 *   - **beforeUpdate**: if the entity has a `@TenantColumn`, assert the
 *     existing row's tenant matches the resolved tenant. Mismatch throws
 *     a `Cross-tenant update` error — protection against developers
 *     using a raw `Repository<T>.update(...)` that bypasses
 *     `TenantAwareRepository`.
 *
 * Entities without `@TenantColumn` are passed through untouched.
 *
 * Register the subscriber on your DataSource:
 *
 * ```ts
 * import { DataSource } from 'typeorm';
 * import { TenantSubscriber } from 'nest-warden/typeorm';
 *
 * const dataSource = new DataSource({
 *   ...,
 *   subscribers: [new TenantSubscriber(() => contextService.tenantId)],
 * });
 * ```
 */
export class TenantSubscriber implements EntitySubscriberInterface {
  constructor(
    /** Reads the active request's tenant ID. Often
     *  `() => tenantContextService.tenantId`. */
    private readonly tenantResolver: TenantResolver,
  ) {}

  beforeInsert(event: InsertEvent<unknown>): void {
    const entity = event.entity;
    if (!entity || typeof entity !== 'object') return;

    const ctor = entity.constructor;
    const tenantField = getTenantColumn(ctor);
    if (!tenantField) return;

    const resolved = this.tenantResolver();
    const record = entity as Record<string, unknown>;
    const current = record[tenantField];

    if (current === undefined || current === null) {
      if (resolved === undefined) {
        throw new Error(
          `TenantSubscriber: cannot insert "${ctor.name}" — no tenant context resolved. ` +
            `Either run inside a request scope, or provide an explicit ${tenantField} on the entity.`,
        );
      }
      record[tenantField] = resolved;
      return;
    }

    if (resolved !== undefined && current !== resolved) {
      throw new Error(
        `TenantSubscriber: refusing to insert "${ctor.name}" with ${tenantField}=${safeFormat(current)} ` +
          `into tenant=${safeFormat(resolved)} (cross-tenant insert).`,
      );
    }
  }

  beforeUpdate(event: UpdateEvent<unknown>): void {
    const entity = event.entity;
    if (!entity || typeof entity !== 'object') return;

    const targetCtor = (event.metadata?.target ?? entity.constructor) as object;
    const tenantField = getTenantColumn(targetCtor);
    if (!tenantField) return;

    const resolved = this.tenantResolver();
    if (resolved === undefined) return; // system context — no enforcement

    const newValue = (entity as Record<string, unknown>)[tenantField];
    if (newValue !== undefined && newValue !== resolved) {
      throw new Error(
        `TenantSubscriber: refusing to update "${/* c8 ignore next */(targetCtor as { name?: string }).name ?? '?'}" ` +
          `with new ${tenantField}=${safeFormat(newValue)} (must equal active tenant=${safeFormat(resolved)}).`,
      );
    }

    const dbValue = (event.databaseEntity as Record<string, unknown> | undefined)?.[tenantField];
    if (dbValue !== undefined && dbValue !== resolved) {
      throw new Error(
        `TenantSubscriber: refusing to update row with stored ${tenantField}=${safeFormat(dbValue)} ` +
          `from tenant=${safeFormat(resolved)} (cross-tenant update).`,
      );
    }
  }
}
