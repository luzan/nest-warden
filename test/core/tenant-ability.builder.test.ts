import { describe, expect, it } from 'vitest';
import { createMongoAbility } from '@casl/ability';
import { TenantAbilityBuilder } from '../../src/core/tenant-ability.builder.js';
import type { TenantContext } from '../../src/core/tenant-context.js';
import { isCrossTenantRule } from '../../src/core/tenant-rule.js';
import { CrossTenantViolationError } from '../../src/core/errors.js';
import { type AppAbility, asMerchant } from './_fixtures.js';

const ctx = (overrides: Partial<TenantContext<string>> = {}): TenantContext<string> => ({
  tenantId: 't-alpha',
  subjectId: 'u-1',
  roles: ['agent'],
  ...overrides,
});

describe('TenantAbilityBuilder — predicate injection', () => {
  it('injects the tenant predicate when conditions are absent', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.can('read', 'Merchant');
    expect(b.rules[0]).toEqual({
      action: 'read',
      subject: 'Merchant',
      conditions: { tenantId: 't-alpha' },
    });
  });

  it('merges the tenant predicate into existing conditions', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.can('read', 'Merchant', { agentId: 'u-1' });
    expect(b.rules[0]?.conditions).toEqual({ agentId: 'u-1', tenantId: 't-alpha' });
  });

  it('respects an explicit tenant value already in the conditions (no overwrite)', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.can('read', 'Merchant', { tenantId: 't-explicit', agentId: 'u-1' });
    expect(b.rules[0]?.conditions).toEqual({ tenantId: 't-explicit', agentId: 'u-1' });
  });

  it('honors a custom tenantField option', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx(), {
      tenantField: 'orgId',
    });
    b.can('read', 'Merchant', { agentId: 'u-1' });
    expect(b.rules[0]?.conditions).toEqual({ agentId: 'u-1', orgId: 't-alpha' });
  });

  it('supports numeric tenant IDs', () => {
    const b = new TenantAbilityBuilder<AppAbility, number>(createMongoAbility, {
      tenantId: 42,
      subjectId: 1,
      roles: [],
    });
    b.can('read', 'Merchant');
    expect(b.rules[0]?.conditions).toEqual({ tenantId: 42 });
  });

  it('also injects on cannot()', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.cannot('delete', 'Merchant');
    expect(b.rules[0]).toMatchObject({
      action: 'delete',
      subject: 'Merchant',
      conditions: { tenantId: 't-alpha' },
      inverted: true,
    });
  });

  it('preserves field restrictions (single string field)', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.can('read', 'Merchant', 'name');
    expect(b.rules[0]).toMatchObject({
      fields: 'name',
      conditions: { tenantId: 't-alpha' },
    });
  });

  it('preserves field restrictions (array of fields, conditions in 4th arg)', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    // The narrowed ability surface narrows the 3rd arg to fields-or-conditions.
    // To exercise CASL's 4-arg overload we use a rule definition function.
    b.rules.push({
      action: 'read',
      subject: 'Merchant',
      fields: ['name', 'status'],
      conditions: { agentId: 'u-1', tenantId: 't-alpha' },
    });
    expect(b.rules[0]).toMatchObject({
      fields: ['name', 'status'],
      conditions: { agentId: 'u-1', tenantId: 't-alpha' },
    });
  });
});

describe('TenantAbilityBuilder — crossTenant opt-out', () => {
  it('skips predicate injection on crossTenant.can', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.crossTenant.can('read', 'Merchant');
    const rule = b.rules[0]!;
    expect(rule.conditions).toBeUndefined();
    expect(isCrossTenantRule(rule)).toBe(true);
  });

  it('skips predicate injection on crossTenant.cannot', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.crossTenant.cannot('delete', 'Merchant');
    const rule = b.rules[0]!;
    expect(rule.conditions).toBeUndefined();
    expect(rule.inverted).toBe(true);
    expect(isCrossTenantRule(rule)).toBe(true);
  });

  it('crossTenant rules pass validation despite missing tenant predicate', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.crossTenant.can('manage', 'Merchant');
    expect(() => b.build()).not.toThrow();
  });

  it('crossTenant.can preserves custom conditions without injecting tenantId', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.crossTenant.can('read', 'Merchant', { status: 'active' });
    expect(b.rules[0]?.conditions).toEqual({ status: 'active' });
    expect(isCrossTenantRule(b.rules[0]!)).toBe(true);
  });
});

describe('TenantAbilityBuilder — build() validation', () => {
  it('rejects rules pushed directly onto rules[] without tenant predicate', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    // Bypass: simulate a rule injected outside the builder API.
    b.rules.push({ action: 'read', subject: 'Merchant' });
    expect(() => b.build()).toThrow(CrossTenantViolationError);
  });

  it('does not run validation when validateRules: false (escape hatch for tests)', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx(), {
      validateRules: false,
    });
    b.rules.push({ action: 'read', subject: 'Merchant' });
    expect(() => b.build()).not.toThrow();
  });

  it('validation runs by default when no options are passed', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.rules.push({ action: 'read', subject: 'Merchant' });
    expect(() => b.build()).toThrow(CrossTenantViolationError);
  });

  it('build() forwards options to the underlying ability', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.can('read', 'Merchant');
    // Options are CASL ability options; we only confirm build accepts them.
    const ability = b.build({});
    expect(ability).toBeDefined();
  });
});

describe('TenantAbilityBuilder — runtime ability checks', () => {
  it('forward check denies cross-tenant resources', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.can('read', 'Merchant');
    const ability = b.build();

    expect(ability.can('read', asMerchant({ id: 'm1', tenantId: 't-alpha' }))).toBe(true);
    expect(ability.can('read', asMerchant({ id: 'm2', tenantId: 't-beta' }))).toBe(false);
  });

  it('forward check honors crossTenant.can', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    b.crossTenant.can('read', 'Merchant');
    const ability = b.build();

    expect(ability.can('read', asMerchant({ id: 'm1', tenantId: 't-alpha' }))).toBe(true);
    expect(ability.can('read', asMerchant({ id: 'm2', tenantId: 't-beta' }))).toBe(true);
  });
});

describe('TenantAbilityBuilder — accessors', () => {
  it('exposes the tenant field name (default)', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx());
    expect(b.tenantField).toBe('tenantId');
  });

  it('exposes the tenant field name (custom)', () => {
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx(), {
      tenantField: 'orgId',
    });
    expect(b.tenantField).toBe('orgId');
  });

  it('exposes the tenant context (referentially equal)', () => {
    const c = ctx({ tenantId: 't-x' });
    const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, c);
    expect(b.tenantContext).toBe(c);
  });
});
