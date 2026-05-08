import { describe, expect, it } from 'vitest';
import { createTenantAbility } from '../../src/core/tenant-ability.js';

describe('createTenantAbility (raw factory)', () => {
  it('produces an ability instance from raw rules (bypassing the builder)', () => {
    const ability = createTenantAbility([
      { action: 'read', subject: 'Merchant', conditions: { tenantId: 't1' } },
    ]);

    expect(
      ability.can('read', { __caslSubjectType__: 'Merchant', tenantId: 't1' } as never),
    ).toBe(true);
    expect(
      ability.can('read', { __caslSubjectType__: 'Merchant', tenantId: 't2' } as never),
    ).toBe(false);
  });

  it('rules with no conditions allow all subjects of the type (raw construction is uncheck-ed)', () => {
    // Documented caveat: rules created through the raw factory bypass
    // validateTenantRules. Use the builder for application code.
    const ability = createTenantAbility([{ action: 'read', subject: 'Merchant' }]);
    expect(ability.can('read', 'Merchant')).toBe(true);
  });
});
