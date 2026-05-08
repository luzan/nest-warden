import { describe, expect, it } from 'vitest';
import { TenantContextService } from '../../src/nestjs/tenant-context.service.js';
import { MissingTenantContextError } from '../../src/core/errors.js';
import type { TenantContext } from '../../src/core/tenant-context.js';

const ctx: TenantContext<string> = { tenantId: 't1', subjectId: 'u1', roles: ['agent'] };

describe('TenantContextService', () => {
  it('starts unset and reports has() === false', () => {
    const svc = new TenantContextService<string>();
    expect(svc.has()).toBe(false);
  });

  it('throws when get() is called before set()', () => {
    const svc = new TenantContextService<string>();
    expect(() => svc.get()).toThrow(MissingTenantContextError);
  });

  it('throws when tenantId getter is accessed before set()', () => {
    const svc = new TenantContextService<string>();
    expect(() => svc.tenantId).toThrow(MissingTenantContextError);
  });

  it('returns the stored context after set()', () => {
    const svc = new TenantContextService<string>();
    svc.set(ctx);
    expect(svc.has()).toBe(true);
    expect(svc.get()).toBe(ctx);
    expect(svc.tenantId).toBe('t1');
  });

  it('overwrites on subsequent set() calls (impersonation flow)', () => {
    const svc = new TenantContextService<string>();
    svc.set(ctx);
    const next: TenantContext<string> = { tenantId: 't2', subjectId: 'u1', roles: ['support'] };
    svc.set(next);
    expect(svc.get()).toBe(next);
  });
});
