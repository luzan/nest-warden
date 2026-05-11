import { describe, expect, it } from 'vitest';
import {
  NestWardenError,
  SystemRoleCollisionError,
  UnknownPermissionError,
} from '../../../src/core/errors.js';

describe('UnknownPermissionError', () => {
  it('extends NestWardenError', () => {
    const err = new UnknownPermissionError('admin', 'merchants:typo');
    expect(err).toBeInstanceOf(NestWardenError);
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes roleName and permission as readonly fields', () => {
    const err = new UnknownPermissionError('admin', 'merchants:typo');
    expect(err.roleName).toBe('admin');
    expect(err.permission).toBe('merchants:typo');
  });

  it('carries a message naming both the role and the missing permission', () => {
    const err = new UnknownPermissionError('admin', 'merchants:typo');
    expect(err.message).toContain('admin');
    expect(err.message).toContain('merchants:typo');
    expect(err.message).toContain('definePermissions');
  });

  it('sets the .name property to the constructor name', () => {
    const err = new UnknownPermissionError('admin', 'x');
    expect(err.name).toBe('UnknownPermissionError');
  });
});

describe('SystemRoleCollisionError', () => {
  it('extends NestWardenError', () => {
    const err = new SystemRoleCollisionError('admin');
    expect(err).toBeInstanceOf(NestWardenError);
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes roleName as a readonly field', () => {
    const err = new SystemRoleCollisionError('admin');
    expect(err.roleName).toBe('admin');
  });

  it('carries a message naming the colliding role', () => {
    const err = new SystemRoleCollisionError('admin');
    expect(err.message).toContain('admin');
    expect(err.message).toContain('reserved');
  });

  it('sets the .name property to the constructor name', () => {
    const err = new SystemRoleCollisionError('admin');
    expect(err.name).toBe('SystemRoleCollisionError');
  });
});
