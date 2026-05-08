import { describe, expect, it } from 'vitest';
import { validateTenantRules } from '../../src/core/validate-rules.js';
import { CrossTenantViolationError } from '../../src/core/errors.js';
import { CROSS_TENANT_MARKER } from '../../src/core/tenant-rule.js';

const opts = { tenantField: 'tenantId' };

describe('validateTenantRules', () => {
  it('accepts a rule with a top-level tenant predicate (scalar)', () => {
    expect(() =>
      validateTenantRules([{ action: 'read', subject: 'M', conditions: { tenantId: 't1' } }], opts),
    ).not.toThrow();
  });

  it('accepts a rule with a top-level tenant predicate (operator form)', () => {
    expect(() =>
      validateTenantRules(
        [{ action: 'read', subject: 'M', conditions: { tenantId: { $eq: 't1' } } }],
        opts,
      ),
    ).not.toThrow();
  });

  it('accepts a rule with tenant inside $and', () => {
    expect(() =>
      validateTenantRules(
        [
          {
            action: 'read',
            subject: 'M',
            conditions: { $and: [{ tenantId: 't1' }, { status: 'active' }] },
          },
        ],
        opts,
      ),
    ).not.toThrow();
  });

  it('rejects a rule with no conditions', () => {
    expect(() => validateTenantRules([{ action: 'read', subject: 'M' }], opts)).toThrow(
      CrossTenantViolationError,
    );
  });

  it('rejects a rule with empty conditions', () => {
    expect(() =>
      validateTenantRules([{ action: 'read', subject: 'M', conditions: {} }], opts),
    ).toThrow(CrossTenantViolationError);
  });

  it('rejects a rule with conditions but no tenantField', () => {
    expect(() =>
      validateTenantRules(
        [{ action: 'read', subject: 'M', conditions: { agentId: 'u1' } }],
        opts,
      ),
    ).toThrow(CrossTenantViolationError);
  });

  it('rejects a rule where tenantId is only in $or (could leak via the other branch)', () => {
    expect(() =>
      validateTenantRules(
        [
          {
            action: 'read',
            subject: 'M',
            conditions: { $or: [{ tenantId: 't1' }, { tenantId: 't2' }] },
          },
        ],
        opts,
      ),
    ).toThrow(CrossTenantViolationError);
  });

  it('rejects a rule where $and contains no tenant predicate', () => {
    expect(() =>
      validateTenantRules(
        [
          {
            action: 'read',
            subject: 'M',
            conditions: { $and: [{ status: 'active' }, { agentId: 'u1' }] },
          },
        ],
        opts,
      ),
    ).toThrow(CrossTenantViolationError);
  });

  it('reports <unspecified> when an offending rule lacks an action', () => {
    try {
      // Pushed via the bypass path; CASL would never produce this but the
      // validator stays robust against malformed input.
      validateTenantRules([{ subject: 'M' }], opts);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('<unspecified>');
    }
  });

  it('rejects rules whose conditions are a non-object scalar', () => {
    expect(() =>
      validateTenantRules([{ action: 'read', subject: 'M', conditions: 'not-an-object' }], opts),
    ).toThrow(CrossTenantViolationError);
  });

  it('handles $and children that are null or non-objects gracefully (rejects the rule)', () => {
    expect(() =>
      validateTenantRules(
        [
          {
            action: 'read',
            subject: 'M',
            // Pathological shapes: empty children, null, scalars.
            conditions: { $and: [null, {}, 'not-an-object'] },
          },
        ],
        opts,
      ),
    ).toThrow(CrossTenantViolationError);
  });

  it('honors a custom tenantField', () => {
    expect(() =>
      validateTenantRules([{ action: 'read', subject: 'M', conditions: { orgId: 'o1' } }], {
        tenantField: 'orgId',
      }),
    ).not.toThrow();

    expect(() =>
      validateTenantRules([{ action: 'read', subject: 'M', conditions: { tenantId: 't1' } }], {
        tenantField: 'orgId',
      }),
    ).toThrow(CrossTenantViolationError);
  });

  it('accepts cross-tenant-marked rules even without predicate', () => {
    const rule = { action: 'read', subject: 'M' };
    Object.defineProperty(rule, CROSS_TENANT_MARKER, { value: true });
    expect(() => validateTenantRules([rule], opts)).not.toThrow();
  });

  it('reports the offending action and subject in the error', () => {
    try {
      validateTenantRules([{ action: 'delete', subject: 'Merchant' }], opts);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CrossTenantViolationError);
      expect((err as Error).message).toContain('delete');
      expect((err as Error).message).toContain('Merchant');
      expect((err as Error).message).toContain('tenantId');
    }
  });
});
