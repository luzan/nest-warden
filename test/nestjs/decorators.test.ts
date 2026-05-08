import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import {
  AllowCrossTenant,
  CheckPolicies,
  Public,
} from '../../src/nestjs/decorators/index.js';
import { currentTenantFactory } from '../../src/nestjs/decorators/current-tenant.decorator.js';
import {
  ALLOW_CROSS_TENANT_KEY,
  CHECK_POLICIES_KEY,
  IS_PUBLIC_KEY,
} from '../../src/nestjs/tokens.js';
import { MissingTenantContextError } from '../../src/core/errors.js';
import type { TenantContext } from '../../src/core/tenant-context.js';

class TestController {
  @Public()
  publicEndpoint(): string {
    return 'ok';
  }

  @CheckPolicies(() => true, { handle: () => true })
  protectedEndpoint(): string {
    return 'protected';
  }

  @AllowCrossTenant('platform-staff-impersonation')
  crossTenantEndpoint(): string {
    return 'cross';
  }
}

// Surface the prototype methods as bare references so the metadata reads
// don't trip the `unbound-method` rule (we never invoke them; we only
// inspect their metadata).
const proto = TestController.prototype;
const handlerOf = (name: keyof TestController): object => Reflect.get(proto, name);

describe('decorators — metadata storage', () => {
  it('@Public() sets IS_PUBLIC_KEY on the handler', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handlerOf('publicEndpoint'))).toBe(true);
  });

  it('@CheckPolicies(...) stores the array of handlers', () => {
    const handlers = Reflect.getMetadata(
      CHECK_POLICIES_KEY,
      handlerOf('protectedEndpoint'),
    ) as unknown[];
    expect(Array.isArray(handlers)).toBe(true);
    expect(handlers).toHaveLength(2);
  });

  it('@AllowCrossTenant(reason) stores the reason code', () => {
    expect(
      Reflect.getMetadata(ALLOW_CROSS_TENANT_KEY, handlerOf('crossTenantEndpoint')),
    ).toBe('platform-staff-impersonation');
  });
});

// Helper: simulate an ExecutionContext for the param decorator.
function fakeExecutionContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('currentTenantFactory (powering @CurrentTenant)', () => {
  it('returns the full TenantContext when no field is requested', () => {
    const ctx: TenantContext = { tenantId: 't1', subjectId: 'u1', roles: ['agent'] };
    const exec = fakeExecutionContext({ tenantContext: ctx });
    expect(currentTenantFactory(undefined, exec)).toBe(ctx);
  });

  it('returns a single field when a key is provided', () => {
    const ctx: TenantContext = { tenantId: 't1', subjectId: 'u1', roles: ['agent'] };
    const exec = fakeExecutionContext({ tenantContext: ctx });
    expect(currentTenantFactory('tenantId', exec)).toBe('t1');
    expect(currentTenantFactory('roles', exec)).toEqual(['agent']);
  });

  it('throws MissingTenantContextError when no tenantContext is on the request', () => {
    const exec = fakeExecutionContext({});
    expect(() => currentTenantFactory(undefined, exec)).toThrow(MissingTenantContextError);
  });
});
