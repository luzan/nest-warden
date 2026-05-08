import { describe, expect, it } from 'vitest';
import { createMongoAbility } from '@casl/ability';
import { TenantAbilityBuilder } from '../../src/core/tenant-ability.builder.js';
import type { TenantContext } from '../../src/core/tenant-context.js';
import { type AppAbility, asMerchant, asPayment } from './_fixtures.js';

const ctx: TenantContext<string> = { tenantId: 't1', subjectId: 'u1', roles: ['agent'] };

describe('Conditional authorization (forward check via CASL mongoQueryMatcher)', () => {
  it('$eq condition matches an exact value', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
    b.can('read', 'Merchant', { status: { $eq: 'active' } });
    const ability = b.build();

    expect(ability.can('read', asMerchant({ id: 'm1', tenantId: 't1', status: 'active' }))).toBe(
      true,
    );
    expect(ability.can('read', asMerchant({ id: 'm2', tenantId: 't1', status: 'inactive' }))).toBe(
      false,
    );
  });

  it('$in condition matches any value in the set', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
    b.can('read', 'Merchant', { status: { $in: ['active', 'pending'] } });
    const ability = b.build();

    expect(ability.can('read', asMerchant({ id: 'm1', tenantId: 't1', status: 'pending' }))).toBe(
      true,
    );
    expect(ability.can('read', asMerchant({ id: 'm2', tenantId: 't1', status: 'closed' }))).toBe(
      false,
    );
  });

  it('$gt / $lt comparison operators work numerically', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
    b.can('update', 'Payment', { amountCents: { $lt: 100_000 } });
    const ability = b.build();

    expect(
      ability.can(
        'update',
        asPayment({ id: 'p1', tenantId: 't1', merchantId: 'm1', amountCents: 99_999 }),
      ),
    ).toBe(true);
    expect(
      ability.can(
        'update',
        asPayment({ id: 'p2', tenantId: 't1', merchantId: 'm1', amountCents: 100_000 }),
      ),
    ).toBe(false);
  });

  it('multiple conditions are AND-combined and the tenant predicate still wins', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
    b.can('update', 'Merchant', { status: 'active', agentId: 'u1' });
    const ability = b.build();

    expect(
      ability.can(
        'update',
        asMerchant({ id: 'm1', tenantId: 't1', status: 'active', agentId: 'u1' }),
      ),
    ).toBe(true);

    // Right tenant + right status, but wrong agent → denied.
    expect(
      ability.can(
        'update',
        asMerchant({ id: 'm2', tenantId: 't1', status: 'active', agentId: 'u2' }),
      ),
    ).toBe(false);

    // Cross-tenant — denied even if everything else matches.
    expect(
      ability.can(
        'update',
        asMerchant({ id: 'm3', tenantId: 't2', status: 'active', agentId: 'u1' }),
      ),
    ).toBe(false);
  });

  it('cannot() with conditions correctly inverts inside the tenant', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
    b.can('manage', 'Merchant');
    b.cannot('manage', 'Merchant', { status: 'closed' });
    const ability = b.build();

    expect(ability.can('manage', asMerchant({ id: 'm1', tenantId: 't1', status: 'active' }))).toBe(
      true,
    );
    expect(ability.can('manage', asMerchant({ id: 'm2', tenantId: 't1', status: 'closed' }))).toBe(
      false,
    );
  });

  it('$ne (not-equal) matches values different from the operand', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
    b.can('read', 'Merchant', { status: { $ne: 'closed' } });
    const ability = b.build();

    expect(ability.can('read', asMerchant({ id: 'm1', tenantId: 't1', status: 'active' }))).toBe(
      true,
    );
    expect(ability.can('read', asMerchant({ id: 'm2', tenantId: 't1', status: 'closed' }))).toBe(
      false,
    );
  });

  it('$nin (not-in) matches values outside the set', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
    b.can('read', 'Merchant', { status: { $nin: ['closed', 'inactive'] } });
    const ability = b.build();

    expect(ability.can('read', asMerchant({ id: 'm1', tenantId: 't1', status: 'active' }))).toBe(
      true,
    );
    expect(ability.can('read', asMerchant({ id: 'm2', tenantId: 't1', status: 'closed' }))).toBe(
      false,
    );
  });
});
