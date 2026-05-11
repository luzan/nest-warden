import { describe, expect, it } from 'vitest';
import {
  CrossTenantViolationError,
  DuplicateRelationshipError,
  InvalidRelationshipPathError,
  MissingTenantContextError,
  MultiTenantCaslError,
  NestWardenError,
  RelationshipDepthExceededError,
  RelationshipNotDefinedError,
  SystemRoleCollisionError,
  UnknownPermissionError,
  UnsupportedOperatorError,
} from '../../src/core/errors.js';
import * as packageRoot from '../../src/index.js';
import * as core from '../../src/core/index.js';

/**
 * Rename contract — Theme 8F (RFC tracked in `things-to-do.md`).
 *
 * `MultiTenantCaslError` was the public base class consumers caught
 * on (`catch (e instanceof MultiTenantCaslError)`). The class is
 * renamed to `NestWardenError` in 0.3.0-alpha; `MultiTenantCaslError`
 * remains exported as a `@deprecated` alias pointing at the same
 * constructor so existing try/catch sites compile and behave
 * identically.
 *
 * These tests pin the contract from outside so a future regression
 * (e.g., turning the alias into a subclass, which would silently
 * break consumer `instanceof MultiTenantCaslError` checks against
 * library-thrown `NestWardenError` instances) fails loudly.
 */
describe('Theme 8F — NestWardenError rename + MultiTenantCaslError alias', () => {
  describe('both names point to the same constructor', () => {
    it('NestWardenError is the canonical class', () => {
      expect(typeof NestWardenError).toBe('function');
      expect(NestWardenError.name).toBe('NestWardenError');
    });

    it('MultiTenantCaslError === NestWardenError (same constructor reference)', () => {
      // The alias must not be a subclass — that would make
      // `caslError instanceof MultiTenantCaslError` return false when
      // `caslError` is actually a NestWardenError, silently breaking
      // every existing catch-site that checks the old name.
      expect(MultiTenantCaslError).toBe(NestWardenError);
    });
  });

  describe('instances satisfy both instanceof checks', () => {
    it('new NestWardenError() is instanceof both names', () => {
      const err = new NestWardenError('msg');
      expect(err).toBeInstanceOf(NestWardenError);
      expect(err).toBeInstanceOf(MultiTenantCaslError);
      expect(err).toBeInstanceOf(Error);
    });

    it('new MultiTenantCaslError() is instanceof both names', () => {
      const err = new MultiTenantCaslError('msg');
      expect(err).toBeInstanceOf(MultiTenantCaslError);
      expect(err).toBeInstanceOf(NestWardenError);
      expect(err).toBeInstanceOf(Error);
    });

    it('instance .name reads as the canonical class name', () => {
      const err = new MultiTenantCaslError('msg');
      // `.name` reflects the actual class — `NestWardenError` even
      // when constructed via the alias. Consumers reading `e.name`
      // for logging will see the new name immediately.
      expect(err.name).toBe('NestWardenError');
    });
  });

  describe('every subclass remains instanceof both base names', () => {
    const cases: Array<[string, () => MultiTenantCaslError]> = [
      ['CrossTenantViolationError', () => new CrossTenantViolationError('read', 'M', 'tenantId')],
      ['MissingTenantContextError', () => new MissingTenantContextError()],
      ['UnsupportedOperatorError', () => new UnsupportedOperatorError('$where')],
      ['RelationshipNotDefinedError', () => new RelationshipNotDefinedError('foo')],
      ['InvalidRelationshipPathError', () => new InvalidRelationshipPathError(['a', 'b'], 'reason')],
      ['RelationshipDepthExceededError', () => new RelationshipDepthExceededError('A', 'B', 3)],
      ['DuplicateRelationshipError', () => new DuplicateRelationshipError('foo')],
      ['UnknownPermissionError', () => new UnknownPermissionError('admin', 'perm')],
      ['SystemRoleCollisionError', () => new SystemRoleCollisionError('admin')],
    ];

    for (const [name, factory] of cases) {
      it(`${name} is instanceof both NestWardenError and MultiTenantCaslError`, () => {
        const err = factory();
        expect(err).toBeInstanceOf(NestWardenError);
        expect(err).toBeInstanceOf(MultiTenantCaslError);
        expect(err).toBeInstanceOf(Error);
      });
    }
  });

  describe('public-surface re-exports', () => {
    it('core barrel exposes NestWardenError', () => {
      expect(core.NestWardenError).toBe(NestWardenError);
    });

    it('core barrel still exposes MultiTenantCaslError (deprecated alias)', () => {
      expect(core.MultiTenantCaslError).toBe(NestWardenError);
    });

    it('package root re-exports both names', () => {
      expect(packageRoot.NestWardenError).toBe(NestWardenError);
      expect(packageRoot.MultiTenantCaslError).toBe(NestWardenError);
    });
  });

  describe('try/catch with the old name still catches new throws', () => {
    it('catch-on MultiTenantCaslError catches a thrown NestWardenError', () => {
      const sentinel = { caught: false };
      try {
        throw new NestWardenError('thrown via the new name');
      } catch (e) {
        if (e instanceof MultiTenantCaslError) sentinel.caught = true;
      }
      expect(sentinel.caught).toBe(true);
    });
  });
});
