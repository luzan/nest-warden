import { describe, expect, it } from 'vitest';
import {
  CrossTenantViolationError,
  MissingTenantContextError,
  NestWardenError,
  UnsupportedOperatorError,
} from '../../src/core/errors.js';

describe('error classes', () => {
  it('CrossTenantViolationError extends NestWardenError and reports name', () => {
    const err = new CrossTenantViolationError('read', 'Merchant', 'tenantId');
    expect(err).toBeInstanceOf(NestWardenError);
    expect(err).toBeInstanceOf(CrossTenantViolationError);
    expect(err.name).toBe('CrossTenantViolationError');
    expect(err.action).toBe('read');
    expect(err.subject).toBe('Merchant');
    expect(err.tenantField).toBe('tenantId');
    expect(err.message).toContain('read');
    expect(err.message).toContain('Merchant');
    expect(err.message).toContain('tenantId');
  });

  it('CrossTenantViolationError serializes array action and subject', () => {
    const err = new CrossTenantViolationError(['read', 'update'], ['Merchant', 'Payment'], 'orgId');
    expect(err.message).toContain('read,update');
    expect(err.message).toContain('Merchant,Payment');
    expect(err.message).toContain('orgId');
  });

  it('CrossTenantViolationError handles undefined subject', () => {
    const err = new CrossTenantViolationError('manage', undefined, 'tenantId');
    expect(err.message).toContain('<all>');
  });

  it('MissingTenantContextError uses default reason if none provided', () => {
    const err = new MissingTenantContextError();
    expect(err).toBeInstanceOf(NestWardenError);
    expect(err.name).toBe('MissingTenantContextError');
    expect(err.message).toContain('No tenant context');
  });

  it('MissingTenantContextError accepts a custom reason', () => {
    const err = new MissingTenantContextError('JWT missing tenant claim');
    expect(err.message).toBe('JWT missing tenant claim');
  });

  it('UnsupportedOperatorError mentions the bad operator and the supported set', () => {
    const err = new UnsupportedOperatorError('$where');
    expect(err).toBeInstanceOf(NestWardenError);
    expect(err.operator).toBe('$where');
    expect(err.message).toContain('$where');
    expect(err.message).toContain('$eq');
    expect(err.message).toContain('$relatedTo');
  });

  it('errors thrown into try/catch retain instanceof through Error catch', () => {
    try {
      throw new CrossTenantViolationError('read', 'M', 'tenantId');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(NestWardenError);
      expect(e).toBeInstanceOf(CrossTenantViolationError);
    }
  });
});
