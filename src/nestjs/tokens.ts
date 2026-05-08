/**
 * Injection tokens used by the NestJS adapter. Symbols rather than strings
 * so they don't collide with consumer-defined tokens of the same display
 * name.
 */
export const MTC_OPTIONS = Symbol.for('nest-warden:options');

/**
 * Reflector metadata keys. Symbol.for ensures the same key resolves
 * across realms (e.g., when the package is bundled into a NestJS
 * worker thread).
 */
export const IS_PUBLIC_KEY = Symbol.for('nest-warden:public');
export const CHECK_POLICIES_KEY = Symbol.for('nest-warden:check-policies');
export const ALLOW_CROSS_TENANT_KEY = Symbol.for('nest-warden:allow-cross-tenant');
