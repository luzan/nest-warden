import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { TenantContextInterceptor } from '../../src/nestjs/tenant-context.interceptor.js';
import { TenantContextService } from '../../src/nestjs/tenant-context.service.js';
import { IS_PUBLIC_KEY } from '../../src/nestjs/tokens.js';
import type { TenantAbilityModuleOptions } from '../../src/nestjs/options.js';
import type { TenantContext } from '../../src/core/tenant-context.js';

const ctx: TenantContext<string> = { tenantId: 't1', subjectId: 'u1', roles: ['agent'] };

const fakeExecCtx = (
  overrides: { request?: object; handler?: () => unknown; cls?: object } = {},
): ExecutionContext => {
  const request = overrides.request ?? {};
  const handler = overrides.handler ?? function fakeHandler(): void {};
  const cls = overrides.cls ?? class FakeController {};
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
};

const fakeNext = (): CallHandler => ({
  handle: () => of('handler-output'),
});

function build(options: TenantAbilityModuleOptions<never, string>): {
  interceptor: TenantContextInterceptor<string>;
  svc: TenantContextService<string>;
} {
  const svc = new TenantContextService<string>();
  const reflector = new Reflector();
  const interceptor = new TenantContextInterceptor<string>(options, svc, reflector);
  return { interceptor, svc };
}

describe('TenantContextInterceptor', () => {
  it('resolves and stores the tenant context for an authenticated request', async () => {
    const resolve = vi.fn().mockResolvedValue(ctx);
    const { interceptor, svc } = build({
      resolveTenantContext: resolve,
      defineAbilities: () => {},
    });

    await firstValueFrom(await interceptor.intercept(fakeExecCtx(), fakeNext()));

    expect(resolve).toHaveBeenCalledOnce();
    expect(svc.has()).toBe(true);
    expect(svc.get()).toBe(ctx);
  });

  it('mirrors the resolved context onto request.tenantContext', async () => {
    const request: Record<string, unknown> = {};
    const { interceptor } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: () => {},
    });

    await firstValueFrom(await interceptor.intercept(fakeExecCtx({ request }), fakeNext()));
    expect(request.tenantContext).toBe(ctx);
  });

  it('skips resolution for routes marked @Public()', async () => {
    const resolve = vi.fn();
    const { interceptor, svc } = build({
      resolveTenantContext: resolve,
      defineAbilities: () => {},
    });

    function publicHandler(): void {}
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, publicHandler);

    await firstValueFrom(
      await interceptor.intercept(fakeExecCtx({ handler: publicHandler }), fakeNext()),
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(svc.has()).toBe(false);
  });

  it('skips resolution when the configured isPublic predicate returns true', async () => {
    const resolve = vi.fn();
    const { interceptor, svc } = build({
      resolveTenantContext: resolve,
      defineAbilities: () => {},
      isPublic: () => true,
    });

    await firstValueFrom(await interceptor.intercept(fakeExecCtx(), fakeNext()));
    expect(resolve).not.toHaveBeenCalled();
    expect(svc.has()).toBe(false);
  });

  it('propagates resolver rejections (fail-closed)', async () => {
    const { interceptor } = build({
      resolveTenantContext: () => Promise.reject(new Error('No active membership')),
      defineAbilities: () => {},
    });

    await expect(interceptor.intercept(fakeExecCtx(), fakeNext())).rejects.toThrow(
      'No active membership',
    );
  });

  it('checks the IS_PUBLIC_KEY on the controller class as a fallback', async () => {
    const resolve = vi.fn();
    const { interceptor, svc } = build({
      resolveTenantContext: resolve,
      defineAbilities: () => {},
    });

    class PublicController {}
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, PublicController);

    await firstValueFrom(
      await interceptor.intercept(fakeExecCtx({ cls: PublicController }), fakeNext()),
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(svc.has()).toBe(false);
  });
});
