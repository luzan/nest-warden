import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createMongoAbility } from '@casl/ability';
import { TenantAbilityBuilder } from '../../src/core/tenant-ability.builder.js';
import type { TenantContext } from '../../src/core/tenant-context.js';
import { type AppAbility, asMerchant } from './_fixtures.js';

describe('TenantAbilityBuilder — invariants (property-based)', () => {
  it('every rule produced via .can()/.cannot() carries the tenant predicate', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }).filter((s) => s.trim().length > 0),
        fc.array(
          fc.record({
            action: fc.constantFrom('read', 'update', 'manage'),
            subject: fc.constantFrom('Merchant', 'Payment', 'Agent'),
            withConditions: fc.boolean(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (tenantId, ops) => {
          const ctx: TenantContext<string> = { tenantId, subjectId: 'u1', roles: [] };
          const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
          for (const op of ops) {
            if (op.withConditions) {
              b.can(op.action, op.subject, { agentId: 'u1' });
            } else {
              b.can(op.action, op.subject);
            }
          }
          for (const rule of b.rules) {
            const conds = (rule as { conditions?: Record<string, unknown> }).conditions;
            expect(conds).toBeDefined();
            expect(conds!.tenantId).toBe(tenantId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a rule never matches a resource carrying a different tenantId', () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.string({ minLength: 1, maxLength: 8 }),
            fc.string({ minLength: 1, maxLength: 8 }),
          )
          .filter(([a, b]) => a !== b),
        ([tenantA, tenantB]) => {
          const ctx: TenantContext<string> = { tenantId: tenantA, subjectId: 'u1', roles: [] };
          const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
          b.can('manage', 'Merchant');
          const ability = b.build();
          expect(ability.can('read', asMerchant({ id: 'm', tenantId: tenantB }))).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('the validator throws CrossTenantViolation for any rule lacking tenant predicate', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.constantFrom('read', 'update', 'manage'),
        fc.constantFrom('Merchant', 'Payment', 'Agent'),
        (tenantId, action, subject) => {
          const ctx: TenantContext<string> = { tenantId, subjectId: 'u1', roles: [] };
          const b = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
          // Push a raw rule that lacks the tenant predicate.
          b.rules.push({ action, subject });
          expect(() => b.build()).toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });
});
