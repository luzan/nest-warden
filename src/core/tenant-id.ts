/**
 * Allowed runtime types for a tenant identifier.
 *
 * Defaults to `string` everywhere in the public API to keep UUIDs the natural
 * fit, but `number` is supported for consumers that key tenants by integer PKs.
 */
export type TenantIdValue = string | number;

/**
 * Public token used as the default field name for the tenant column on
 * resources and the tenant claim on contexts. Configurable per-builder via
 * `TenantBuilderOptions.tenantField`.
 */
export const DEFAULT_TENANT_FIELD = 'tenantId' as const;
