import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { createMongoAbility, type MongoAbility } from '@casl/ability';
import { TenantAbilityFactory } from '../../src/nestjs/tenant-ability.factory.js';
import { TenantContextService } from '../../src/nestjs/tenant-context.service.js';
import type { TenantAbilityModuleOptions } from '../../src/nestjs/options.js';
import type { TenantContext } from '../../src/core/tenant-context.js';

type AppAbility = MongoAbility;
const ctx: TenantContext<string> = { tenantId: 't1', subjectId: 'u1', roles: ['agent'] };

function build(options: TenantAbilityModuleOptions<AppAbility, string>): {
  factory: TenantAbilityFactory<AppAbility, string>;
  svc: TenantContextService<string>;
} {
  const svc = new TenantContextService<string>();
  const factory = new TenantAbilityFactory<AppAbility, string>(options, svc);
  return { factory, svc };
}

describe('TenantAbilityFactory', () => {
  it('builds a per-request ability from the resolved context and rules', async () => {
    const { factory, svc } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: (builder) => {
        builder.can('read', 'Merchant');
      },
      abilityClass: createMongoAbility,
    });
    svc.set(ctx);

    const ability = await factory.build();
    expect(ability.can('read', 'Merchant')).toBe(true);
  });

  it('passes the request through to defineAbilities', async () => {
    let captured: unknown;
    const { factory, svc } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: (builder, _ctx, request) => {
        captured = request;
        builder.can('read', 'Merchant');
      },
      abilityClass: createMongoAbility,
    });
    svc.set(ctx);

    const fakeRequest = { url: '/x' };
    await factory.build(fakeRequest);
    expect(captured).toBe(fakeRequest);
  });

  it('throws when build() is called before the context is resolved', async () => {
    const { factory } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: () => {},
    });
    await expect(factory.build()).rejects.toThrow(/before TenantContextInterceptor ran/);
  });

  it('honors validateRulesAtBuild = false (escape hatch)', async () => {
    const { factory, svc } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: (builder) => {
        builder.rules.push({ action: 'read', subject: 'Merchant' });
      },
      validateRulesAtBuild: false,
    });
    svc.set(ctx);
    await expect(factory.build()).resolves.toBeDefined();
  });

  it('runs validateTenantRules by default (rejects rules missing tenant predicate)', async () => {
    const { factory, svc } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: (builder) => {
        builder.rules.push({ action: 'read', subject: 'Merchant' });
      },
    });
    svc.set(ctx);
    await expect(factory.build()).rejects.toThrow(/missing the required tenant predicate/);
  });

  it('supports async defineAbilities (e.g., loading roles from a database)', async () => {
    const { factory, svc } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: async (builder) => {
        await Promise.resolve();
        builder.can('read', 'Merchant');
      },
    });
    svc.set(ctx);
    const ability = await factory.build();
    expect(ability.can('read', 'Merchant')).toBe(true);
  });

  it('falls back to createMongoAbility when no abilityClass is provided', async () => {
    const { factory, svc } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: (builder) => {
        builder.can('read', 'Merchant');
      },
    });
    svc.set(ctx);
    const ability = await factory.build();
    expect(ability.can('read', 'Merchant')).toBe(true);
  });
});
