import { describe, expect, it } from 'vitest';
import * as packageRoot from '../../src/index.js';
import * as core from '../../src/core/index.js';

describe('public surface', () => {
  it('package root re-exports the core API', () => {
    expect(packageRoot.TenantAbilityBuilder).toBe(core.TenantAbilityBuilder);
    expect(packageRoot.createTenantAbility).toBe(core.createTenantAbility);
    expect(packageRoot.DEFAULT_TENANT_FIELD).toBe(core.DEFAULT_TENANT_FIELD);
  });

  it('core barrel exposes every documented surface', () => {
    expect(typeof core.TenantAbilityBuilder).toBe('function');
    expect(typeof core.createTenantAbility).toBe('function');
    expect(typeof core.tenantConditionsMatcher).toBe('function');
    expect(typeof core.validateTenantRules).toBe('function');
    expect(typeof core.markCrossTenant).toBe('function');
    expect(typeof core.isCrossTenantRule).toBe('function');
    expect(core.CROSS_TENANT_MARKER).toBe('__mtCrossTenant');
    expect(core.DEFAULT_TENANT_FIELD).toBe('tenantId');
    // Error classes
    expect(typeof core.CrossTenantViolationError).toBe('function');
    expect(typeof core.MissingTenantContextError).toBe('function');
    expect(typeof core.MultiTenantCaslError).toBe('function');
    expect(typeof core.UnsupportedOperatorError).toBe('function');
  });
});
