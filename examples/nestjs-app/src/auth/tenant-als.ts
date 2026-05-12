import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Shape of what the ALS carries per request. Just the tenant id —
 * adding more here is risky (the store is read from inside TypeORM's
 * hot path; growing it grows every save's cost).
 */
export interface TenantAlsStore {
  readonly tenantId: string;
}

/**
 * Per-request `AsyncLocalStorage` that bridges the NestJS request
 * scope into non-Nest-managed code.
 *
 * Why this exists:
 *
 *   `TenantSubscriber` (in `nest-warden/typeorm`) is registered as
 *   a TypeORM `EntitySubscriberInterface` on the application-wide
 *   `DataSource`. The DataSource is a singleton — TypeORM has no
 *   notion of NestJS's REQUEST scope, and the subscriber's
 *   constructor runs exactly once at module bootstrap. That means
 *   a closure over the request-scoped `TenantContextService` (which
 *   would be the natural way to wire the resolver) isn't reachable
 *   from the subscriber.
 *
 *   The workaround: Node's `AsyncLocalStorage` keeps a per-request
 *   value associated with the async-execution context. The
 *   {@link TenantAlsInterceptor} enters the store at the start of
 *   every authenticated request; the subscriber reads via
 *   `tenantAls.getStore()` from inside TypeORM's beforeInsert /
 *   beforeUpdate hooks.
 *
 *   This is example-app code — not part of the library — because
 *   the right shape of the bridge depends on the consumer's
 *   request-handling stack (Fastify vs Express vs hybrid). The
 *   library ships the subscriber and expects the consumer to wire
 *   the resolver however suits their app.
 */
export const tenantAls = new AsyncLocalStorage<TenantAlsStore>();

/**
 * Resolver passed to `TenantSubscriber` at module init. Reads the
 * active tenant id from the request-scoped ALS store.
 *
 * Returns `undefined` outside an authenticated request (system
 * jobs, migrations); the subscriber treats undefined as "no
 * enforcement" rather than failing closed, matching the documented
 * behaviour for system-context writes.
 */
export function resolveTenantIdFromAls(): string | undefined {
  return tenantAls.getStore()?.tenantId;
}
