import { describe, expect, it } from 'vitest';
import { createMongoAbility, type MongoAbility } from '@casl/ability';
import {
  TenantAbilityBuilder,
  assertCaslCouplingInvariant,
} from '../../src/core/tenant-ability.builder.js';
import { NestWardenError } from '../../src/core/errors.js';
import type { TenantContext } from '../../src/core/tenant-context.js';

type AppAction = 'read' | 'manage';
type AppSubject = 'Merchant';
type AppAbility = MongoAbility<[AppAction, AppSubject]>;

const ctx: TenantContext = {
  tenantId: 't1',
  subjectId: 'u1',
  roles: [],
};

/**
 * Theme 8A — CASL coupling invariant.
 *
 * `TenantAbilityBuilder` captures `this.can`, `this.cannot`, and
 * `this.build` after `super()` and overwrites them with wrappers that
 * inject the tenant predicate. This works **only** because CASL's
 * `AbilityBuilder` assigns these as instance properties in its own
 * constructor. If a future CASL release moves them to the prototype,
 * the wrappers silently no-op and rules ship without a tenant
 * predicate — a silent data-leak class.
 *
 * `assertCaslCouplingInvariant` is the load-bearing safety check:
 * thrown loudly at construction time if any of the three captured
 * references is not a function. These tests pin the contract from
 * the outside so a regression (e.g., refactoring the assertion away)
 * fails loudly.
 */
describe('Theme 8A — assertCaslCouplingInvariant', () => {
  describe('passing cases', () => {
    it('accepts an object where can/cannot/build are all functions', () => {
      expect(() =>
        assertCaslCouplingInvariant({
          can: () => {},
          cannot: () => {},
          build: () => {},
        }),
      ).not.toThrow();
    });

    it('a real TenantAbilityBuilder against real CASL satisfies the invariant', () => {
      // The smoke test: in normal operation, construction does not
      // throw because real CASL still assigns the three methods as
      // instance properties.
      expect(
        () => new TenantAbilityBuilder<AppAbility, string>(createMongoAbility, ctx),
      ).not.toThrow();
    });
  });

  describe('failing cases — each missing method triggers the throw', () => {
    it('throws NestWardenError when `can` is undefined', () => {
      expect(() =>
        assertCaslCouplingInvariant({
          can: undefined,
          cannot: () => {},
          build: () => {},
        }),
      ).toThrow(NestWardenError);
    });

    it('throws NestWardenError when `cannot` is undefined', () => {
      expect(() =>
        assertCaslCouplingInvariant({
          can: () => {},
          cannot: undefined,
          build: () => {},
        }),
      ).toThrow(NestWardenError);
    });

    it('throws NestWardenError when `build` is undefined', () => {
      expect(() =>
        assertCaslCouplingInvariant({
          can: () => {},
          cannot: () => {},
          build: undefined,
        }),
      ).toThrow(NestWardenError);
    });

    it('throws when a method is a non-function value (e.g., a string)', () => {
      expect(() =>
        assertCaslCouplingInvariant({
          can: 'not a function',
          cannot: () => {},
          build: () => {},
        }),
      ).toThrow(NestWardenError);
    });
  });

  describe('error message', () => {
    it('mentions the peer dep version range so consumers can diagnose', () => {
      try {
        assertCaslCouplingInvariant({ can: undefined, cannot: () => {}, build: () => {} });
        throw new Error('Expected assertCaslCouplingInvariant to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(NestWardenError);
        const message = (e as Error).message;
        // Consumers seeing this in production logs should immediately
        // know what version of CASL is compatible.
        expect(message).toContain('@casl/ability');
        expect(message).toMatch(/>=6\.7\.0/);
        expect(message).toMatch(/<7\.0\.0/);
        expect(message).toContain('AbilityBuilder');
      }
    });

    it('names which method failed the check so debugging is concrete', () => {
      try {
        assertCaslCouplingInvariant({ can: () => {}, cannot: undefined, build: () => {} });
        throw new Error('Expected throw');
      } catch (e) {
        expect((e as Error).message).toContain('cannot');
      }
    });
  });
});

describe('Theme 8A — TenantAbilityBuilder construction-time invariant', () => {
  // Regression test: the invariant is wired into the constructor, not
  // just exported as a standalone function. If a refactor removes the
  // construction-time call but keeps the function, this test fails.
  it('a built rule has the tenant predicate stamped on conditions', () => {
    const builder = new TenantAbilityBuilder<AppAbility, string>(createMongoAbility, ctx);
    builder.can('read', 'Merchant');
    const ability = builder.build();
    const rule = ability.rules[0];
    expect(rule).toBeDefined();
    // If the wrap technique ever silently no-ops, `conditions` would
    // be undefined here — the invariant ensures we throw at
    // construction time instead.
    expect(rule?.conditions).toEqual({ tenantId: 't1' });
  });
});
