import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { TenantAbilityModule } from '../../src/nestjs/tenant-ability.module.js';
import { TenantContextService } from '../../src/nestjs/tenant-context.service.js';
import { TenantAbilityFactory } from '../../src/nestjs/tenant-ability.factory.js';
import { TenantContextInterceptor } from '../../src/nestjs/tenant-context.interceptor.js';
import { TenantPoliciesGuard } from '../../src/nestjs/guards/tenant-policies.guard.js';
import { MTC_OPTIONS } from '../../src/nestjs/tokens.js';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { TenantContext } from '../../src/core/tenant-context.js';

const ctx: TenantContext<string> = { tenantId: 't1', subjectId: 'u1', roles: ['agent'] };

describe('TenantAbilityModule.forRoot', () => {
  it('registers the core providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TenantAbilityModule.forRoot({
          resolveTenantContext: () => ctx,
          defineAbilities: () => {},
        }),
      ],
    }).compile();

    const tokens = await Promise.all([
      moduleRef.resolve(TenantContextService),
      moduleRef.resolve(TenantAbilityFactory),
      moduleRef.resolve(TenantContextInterceptor),
      moduleRef.resolve(TenantPoliciesGuard),
    ]);
    expect(tokens.every((t) => t !== undefined)).toBe(true);

    const options = moduleRef.get(MTC_OPTIONS);
    expect(options).toBeDefined();
  });

  it('returns a global module so providers are available without re-import', () => {
    const dynamic = TenantAbilityModule.forRoot({
      resolveTenantContext: () => ctx,
      defineAbilities: () => {},
    });
    expect(dynamic.global).toBe(true);
  });

  it('registers APP_INTERCEPTOR + APP_GUARD by default', () => {
    const dynamic = TenantAbilityModule.forRoot({
      resolveTenantContext: () => ctx,
      defineAbilities: () => {},
    });
    const tokens = (dynamic.providers ?? [])
      .map((p) => (typeof p === 'object' && p !== null && 'provide' in p ? p.provide : null))
      .filter((t) => t === APP_INTERCEPTOR || t === APP_GUARD);
    expect(tokens).toContain(APP_INTERCEPTOR);
    expect(tokens).toContain(APP_GUARD);
  });

  it('skips global registration when module.registerAsGlobal: false', () => {
    const dynamic = TenantAbilityModule.forRoot({
      resolveTenantContext: () => ctx,
      defineAbilities: () => {},
      module: { registerAsGlobal: false },
    });
    const tokens = (dynamic.providers ?? [])
      .map((p) => (typeof p === 'object' && p !== null && 'provide' in p ? p.provide : null))
      .filter((t) => t === APP_INTERCEPTOR || t === APP_GUARD);
    expect(tokens).toHaveLength(0);
  });

  it('exports the public providers', () => {
    const dynamic = TenantAbilityModule.forRoot({
      resolveTenantContext: () => ctx,
      defineAbilities: () => {},
    });
    expect(dynamic.exports).toContain(TenantContextService);
    expect(dynamic.exports).toContain(TenantAbilityFactory);
    expect(dynamic.exports).toContain(TenantContextInterceptor);
    expect(dynamic.exports).toContain(TenantPoliciesGuard);
    expect(dynamic.exports).toContain(MTC_OPTIONS);
  });
});

describe('TenantAbilityModule.forRootAsync', () => {
  it('resolves options through useFactory + inject', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TenantAbilityModule.forRootAsync({
          useFactory: () => ({
            resolveTenantContext: () => ctx,
            defineAbilities: () => {},
          }),
        }),
      ],
    }).compile();

    const options = moduleRef.get(MTC_OPTIONS);
    expect(options).toBeDefined();
  });

  it('forwards `imports` to the dynamic module', () => {
    class FakeImport {}
    const dynamic = TenantAbilityModule.forRootAsync({
      imports: [FakeImport],
      useFactory: () => ({
        resolveTenantContext: () => ctx,
        defineAbilities: () => {},
      }),
    });
    expect(dynamic.imports).toEqual([FakeImport]);
  });

  it('defaults to no imports + no inject when omitted', () => {
    const dynamic = TenantAbilityModule.forRootAsync({
      useFactory: () => ({
        resolveTenantContext: () => ctx,
        defineAbilities: () => {},
      }),
    });
    expect(dynamic.imports).toEqual([]);
    const optionsProvider = (dynamic.providers ?? []).find(
      (p) => typeof p === 'object' && p !== null && 'provide' in p && p.provide === MTC_OPTIONS,
    ) as { inject?: unknown[] } | undefined;
    expect(optionsProvider?.inject).toEqual([]);
  });

  it('forwards `inject` tokens to the options provider', () => {
    const FAKE_TOKEN = Symbol('fake');
    const dynamic = TenantAbilityModule.forRootAsync({
      inject: [FAKE_TOKEN],
      useFactory: () => ({
        resolveTenantContext: () => ctx,
        defineAbilities: () => {},
      }),
    });
    const optionsProvider = (dynamic.providers ?? []).find(
      (p) => typeof p === 'object' && p !== null && 'provide' in p && p.provide === MTC_OPTIONS,
    ) as { inject?: unknown[] } | undefined;
    expect(optionsProvider?.inject).toEqual([FAKE_TOKEN]);
  });

  it('registers APP_INTERCEPTOR + APP_GUARD by default', () => {
    const dynamic = TenantAbilityModule.forRootAsync({
      useFactory: () => ({
        resolveTenantContext: () => ctx,
        defineAbilities: () => {},
      }),
    });
    const tokens = (dynamic.providers ?? [])
      .map((p) => (typeof p === 'object' && p !== null && 'provide' in p ? p.provide : null))
      .filter((t) => t === APP_INTERCEPTOR || t === APP_GUARD);
    expect(tokens).toContain(APP_INTERCEPTOR);
    expect(tokens).toContain(APP_GUARD);
  });

  it('skips global registration when registerAsGlobal: false', () => {
    const dynamic = TenantAbilityModule.forRootAsync({
      registerAsGlobal: false,
      useFactory: () => ({
        resolveTenantContext: () => ctx,
        defineAbilities: () => {},
      }),
    });
    const tokens = (dynamic.providers ?? [])
      .map((p) => (typeof p === 'object' && p !== null && 'provide' in p ? p.provide : null))
      .filter((t) => t === APP_INTERCEPTOR || t === APP_GUARD);
    expect(tokens).toHaveLength(0);
  });

  it('returns a global module so providers are available without re-import', () => {
    const dynamic = TenantAbilityModule.forRootAsync({
      useFactory: () => ({
        resolveTenantContext: () => ctx,
        defineAbilities: () => {},
      }),
    });
    expect(dynamic.global).toBe(true);
  });
});
