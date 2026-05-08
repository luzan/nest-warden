import type { TenantIdValue } from './tenant-id.js';

/**
 * Per-request authorization context.
 *
 * Server-side (NestJS): produced by `TenantContextInterceptor` after a
 * server-authoritative membership lookup; do not trust client-supplied claims
 * directly.
 *
 * Client-side: typically built once at session bootstrap from a verified
 * `/me` payload and reused for the page lifetime.
 */
export interface TenantContext<TId extends TenantIdValue = string> {
  readonly tenantId: TId;
  readonly subjectId: string | number;
  readonly roles: readonly string[];
  /** Free-form context attributes (e.g., `actingNodeId`, locale). Treated as opaque by core. */
  readonly attributes?: Readonly<Record<string, unknown>>;
}
