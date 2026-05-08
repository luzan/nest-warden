import { describe, expect, it } from 'vitest';
import {
  CROSS_TENANT_MARKER,
  isCrossTenantRule,
  markCrossTenant,
} from '../../src/core/tenant-rule.js';

describe('tenant-rule helpers', () => {
  it('isCrossTenantRule returns false for an unmarked rule', () => {
    expect(isCrossTenantRule({})).toBe(false);
    expect(isCrossTenantRule({ action: 'read' })).toBe(false);
  });

  it('markCrossTenant tags an object so isCrossTenantRule reports true', () => {
    const rule = { action: 'read', subject: 'Merchant' };
    markCrossTenant(rule);
    expect(isCrossTenantRule(rule)).toBe(true);
    expect(Reflect.get(rule, CROSS_TENANT_MARKER)).toBe(true);
  });

  it('markCrossTenant produces a non-enumerable marker', () => {
    const rule = { action: 'read' };
    markCrossTenant(rule);
    const enumerable = Object.keys(rule);
    expect(enumerable).not.toContain(CROSS_TENANT_MARKER);
  });

  it('markCrossTenant produces a non-writable marker (strict mode)', () => {
    const rule = { action: 'read' };
    markCrossTenant(rule);
    // ESM modules are evaluated in strict mode; assignment to a non-writable
    // property therefore throws TypeError rather than silently failing.
    expect(() => {
      Reflect.set(rule, CROSS_TENANT_MARKER, false);
    }).not.toThrow(); // Reflect.set returns false instead of throwing
    expect(Reflect.set(rule, CROSS_TENANT_MARKER, false)).toBe(false);
    expect(isCrossTenantRule(rule)).toBe(true);
  });

  it('markCrossTenant is idempotent on already-marked rules', () => {
    const rule = { action: 'read' };
    markCrossTenant(rule);
    expect(() => markCrossTenant(rule)).not.toThrow();
    expect(isCrossTenantRule(rule)).toBe(true);
  });

  it('CROSS_TENANT_MARKER is a stable constant', () => {
    expect(CROSS_TENANT_MARKER).toBe('__mtCrossTenant');
  });
});
