import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { type MongoAbility } from '@casl/ability';
import { TenantPoliciesGuard } from '../../src/nestjs/guards/tenant-policies.guard.js';
import { TenantAbilityFactory } from '../../src/nestjs/tenant-ability.factory.js';
import { TenantContextService } from '../../src/nestjs/tenant-context.service.js';
import { CHECK_POLICIES_KEY, IS_PUBLIC_KEY } from '../../src/nestjs/tokens.js';
import type { TenantAbilityModuleOptions } from '../../src/nestjs/options.js';
import type { TenantContext } from '../../src/core/tenant-context.js';

type AppAbility = MongoAbility;
const ctx: TenantContext<string> = { tenantId: 't1', subjectId: 'u1', roles: ['agent'] };

function build(options: TenantAbilityModuleOptions<AppAbility, string>): {
  guard: TenantPoliciesGuard<AppAbility>;
  svc: TenantContextService<string>;
} {
  const svc = new TenantContextService<string>();
  const factory = new TenantAbilityFactory<AppAbility, string>(options, svc);
  const guard = new TenantPoliciesGuard<AppAbility>(
    new Reflector(),
    factory,
    svc,
    options,
  );
  return { guard, svc };
}

const fakeExecCtx = (overrides: { request?: object; handler?: () => unknown; cls?: object } = {}): ExecutionContext => {
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

describe('TenantPoliciesGuard', () => {
  it('returns true for routes marked @Public()', async () => {
    const { guard } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: () => {},
    });
    function publicHandler(): void {}
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, publicHandler);

    expect(await guard.canActivate(fakeExecCtx({ handler: publicHandler }))).toBe(true);
  });

  it('returns true for routes without @CheckPolicies (policies are opt-in)', async () => {
    const { guard } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: () => {},
    });
    expect(await guard.canActivate(fakeExecCtx())).toBe(true);
  });

  it('passes when every handler returns true', async () => {
    const { guard, svc } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: (builder) => {
        builder.can('read', 'Merchant');
      },
    });
    svc.set(ctx);

    function handler(): void {}
    Reflect.defineMetadata(
      CHECK_POLICIES_KEY,
      [(ability: AppAbility) => ability.can('read', 'Merchant')],
      handler,
    );

    const request = {};
    expect(await guard.canActivate(fakeExecCtx({ handler, request }))).toBe(true);
    expect((request as { ability?: AppAbility }).ability).toBeDefined();
  });

  it('throws ForbiddenException when any handler returns false', async () => {
    const { guard, svc } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: (builder) => {
        builder.can('read', 'Merchant');
      },
    });
    svc.set(ctx);

    function handler(): void {}
    Reflect.defineMetadata(
      CHECK_POLICIES_KEY,
      [(ability: AppAbility) => ability.can('delete', 'Merchant')],
      handler,
    );

    await expect(guard.canActivate(fakeExecCtx({ handler }))).rejects.toThrow(ForbiddenException);
  });

  it('supports object-form PolicyHandlers', async () => {
    const { guard, svc } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: (builder) => {
        builder.can('read', 'Merchant');
      },
    });
    svc.set(ctx);

    function handler(): void {}
    Reflect.defineMetadata(
      CHECK_POLICIES_KEY,
      [{ handle: (ability: AppAbility) => ability.can('read', 'Merchant') }],
      handler,
    );

    expect(await guard.canActivate(fakeExecCtx({ handler }))).toBe(true);
  });
});
