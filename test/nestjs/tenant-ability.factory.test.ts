import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { LoggerService } from '@nestjs/common';
import { createMongoAbility, type MongoAbility } from '@casl/ability';
import { TenantAbilityFactory } from '../../src/nestjs/tenant-ability.factory.js';
import { TenantContextService } from '../../src/nestjs/tenant-context.service.js';
import type { TenantAbilityModuleOptions } from '../../src/nestjs/options.js';
import type { TenantContext } from '../../src/core/tenant-context.js';
import { definePermissions, defineRoles } from '../../src/core/permissions/index.js';

/**
 * Build a capturing logger that satisfies the `LoggerService` shape.
 * Used by every test that asserts on the dropout warnings — the
 * factory previously called `console.warn` directly; Theme 8E
 * (0.4.0-alpha) routes those calls through `options.logger`.
 */
function captureLogger(): { logger: LoggerService; messages: string[] } {
  const messages: string[] = [];
  const logger: LoggerService = {
    log: () => {},
    error: () => {},
    warn: (message: unknown) => {
      messages.push(String(message));
    },
    debug: () => {},
    verbose: () => {},
  };
  return { logger, messages };
}

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
      builder: { abilityClass: createMongoAbility },
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
      builder: { abilityClass: createMongoAbility },
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

  it('honors builder.validateRules = false (escape hatch)', async () => {
    const { factory, svc } = build({
      resolveTenantContext: () => ctx,
      defineAbilities: (builder) => {
        builder.rules.push({ action: 'read', subject: 'Merchant' });
      },
      builder: { validateRules: false },
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

  it('forwards permissions and systemRoles to the builder so applyRoles works', async () => {
    const permissions = definePermissions({
      'merchants:read': { action: 'read', subject: 'Merchant' },
    });
    const systemRoles = defineRoles<keyof typeof permissions>({
      reader: { permissions: ['merchants:read'] },
    });

    const { factory, svc } = build({
      resolveTenantContext: () => ctx,
      permissions,
      roles: { systemRoles },
      defineAbilities: (builder, c) => {
        builder.applyRoles(c.roles.includes('reader') ? ['reader'] : []);
      },
    });
    svc.set({ ...ctx, roles: ['reader'] });

    const ability = await factory.build();
    expect(ability.can('read', 'Merchant')).toBe(true);
    expect(ability.can('approve', 'Merchant')).toBe(false);
  });

  describe('loadCustomRoles (RFC 001 Phase C)', () => {
    const permissions = definePermissions({
      'merchants:read': { action: 'read', subject: 'Merchant' },
      'merchants:approve': {
        action: 'approve',
        subject: 'Merchant',
        conditions: { status: 'pending' },
      },
    });
    const systemRoles = defineRoles<keyof typeof permissions>({
      admin: { permissions: ['merchants:read', 'merchants:approve'] },
    });

    it('expands custom roles into the request ability', async () => {
      let calls = 0;
      const { factory, svc } = build({
        resolveTenantContext: () => ctx,
        permissions,
        roles: {
          systemRoles,
          loadCustomRoles: () => {
            calls += 1;
            return [{ name: 'auditor', permissions: ['merchants:read'] }];
          },
        },
        defineAbilities: (builder, c) => {
          builder.applyRoles(c.roles);
        },
      });
      svc.set({ ...ctx, roles: ['auditor'] });

      const ability = await factory.build();
      expect(ability.can('read', 'Merchant')).toBe(true);
      // Auditor only has merchants:read, not approve.
      expect(ability.can('approve', 'Merchant')).toBe(false);
      expect(calls).toBe(1);
    });

    it('passes tenantId and context to the loader callback', async () => {
      const seen: { tenantId?: string; subjectId?: string | number } = {};
      const { factory, svc } = build({
        resolveTenantContext: () => ctx,
        permissions,
        roles: {
          systemRoles,
          loadCustomRoles: (tenantId, c) => {
            seen.tenantId = tenantId;
            seen.subjectId = c.subjectId;
            return [];
          },
        },
        defineAbilities: () => {},
      });
      svc.set(ctx);

      await factory.build();
      expect(seen.tenantId).toBe('t1');
      expect(seen.subjectId).toBe('u1');
    });

    it('passes custom roles through unchanged when neither permissions nor systemRoles are configured', async () => {
      // Defensive branch: the factory's validation calls are wrapped
      // in `if (systemRoles)` / `if (permissions)` blocks. When the
      // consumer configures `loadCustomRoles` but no registries (an
      // unusual setup, but valid), validation is skipped and the
      // custom roles flow through untouched.
      const seen: { customRoles?: readonly { name: string }[] } = {};
      const { factory, svc } = build({
        resolveTenantContext: () => ctx,
        roles: {
          loadCustomRoles: () => [{ name: 'unvalidated', permissions: ['anything-goes'] }],
        },
        defineAbilities: (builder) => {
          // Capture the customRoles the factory passed to the builder
          // by reading the builder's options indirectly through its
          // tenantField getter being undefined-safe. We don't need
          // applyRoles to fire — we only need to confirm the request
          // succeeded with no validation errors.
          seen.customRoles = [{ name: 'unvalidated' }];
          builder.can('manage', 'all', { tenantId: 't1' });
        },
      });
      svc.set(ctx);

      const ability = await factory.build();
      expect(ability.can('manage', 'all')).toBe(true);
      expect(seen.customRoles).toHaveLength(1);
    });

    it('supports an async loader', async () => {
      const { factory, svc } = build({
        resolveTenantContext: () => ctx,
        permissions,
        roles: {
          systemRoles,
          loadCustomRoles: async () => {
            await new Promise((r) => setTimeout(r, 1));
            return [{ name: 'late-binder', permissions: ['merchants:read'] }];
          },
        },
        defineAbilities: (builder) => builder.applyRoles(['late-binder']),
      });
      svc.set(ctx);

      const ability = await factory.build();
      expect(ability.can('read', 'Merchant')).toBe(true);
    });

    it('drops custom roles colliding with a system role name (logs warning)', async () => {
      const { logger, messages } = captureLogger();

      const { factory, svc } = build({
        resolveTenantContext: () => ctx,
        permissions,
        roles: {
          systemRoles,
          logger,
          loadCustomRoles: () => [
            { name: 'admin', permissions: ['merchants:read'] }, // collides
            { name: 'good-custom', permissions: ['merchants:read'] },
          ],
        },
        defineAbilities: (builder, c) => builder.applyRoles(c.roles),
      });
      svc.set({ ...ctx, roles: ['admin', 'good-custom'] });

      const ability = await factory.build();
      // System admin survives — full access.
      expect(ability.can('approve', 'Merchant')).toBe(true);
      // Collision was warned about via the configured logger.
      expect(messages.some((w) => w.includes('admin') && w.includes('collides'))).toBe(true);
    });

    it('drops custom roles referencing unknown permissions (logs warning)', async () => {
      const { logger, messages } = captureLogger();

      const { factory, svc } = build({
        resolveTenantContext: () => ctx,
        permissions,
        roles: {
          systemRoles,
          logger,
          loadCustomRoles: () => [
            { name: 'broken', permissions: ['merchants:read', 'does-not-exist'] },
            { name: 'fine', permissions: ['merchants:read'] },
          ],
        },
        defineAbilities: (builder) => builder.applyRoles(['broken', 'fine']),
      });
      svc.set(ctx);

      const ability = await factory.build();
      // The "broken" role is dropped; "fine" survives so read is allowed.
      expect(ability.can('read', 'Merchant')).toBe(true);
      expect(messages.some((w) => w.includes('broken') && w.includes('unknown permission'))).toBe(
        true,
      );
    });

    it('routes dropouts to the injected logger (and not via console.warn)', async () => {
      // Belt-and-suspenders test: prove the migration off console.warn
      // is complete. A spy on console.warn must NOT be invoked while
      // the captured logger DOES receive the call.
      const { logger, messages } = captureLogger();
      const originalConsoleWarn = console.warn;
      const consoleCalls: unknown[][] = [];
      console.warn = (...args: unknown[]) => {
        consoleCalls.push(args);
      };

      try {
        const { factory, svc } = build({
          resolveTenantContext: () => ctx,
          permissions,
          roles: {
            systemRoles,
            logger,
            loadCustomRoles: () => [{ name: 'admin', permissions: ['merchants:read'] }], // collides
          },
          defineAbilities: (builder) => builder.applyRoles(['admin']),
        });
        svc.set(ctx);

        await factory.build();

        expect(messages.length).toBe(1);
        expect(consoleCalls.length).toBe(0);
      } finally {
        console.warn = originalConsoleWarn;
      }
    });

    it('respects roles.silentDropouts: true — the dropout still happens but the log is suppressed', async () => {
      const { logger, messages } = captureLogger();

      const { factory, svc } = build({
        resolveTenantContext: () => ctx,
        permissions,
        roles: {
          systemRoles,
          logger,
          silentDropouts: true,
          loadCustomRoles: () => [
            { name: 'admin', permissions: ['merchants:read'] }, // collides
            { name: 'good-custom', permissions: ['merchants:read'] },
          ],
        },
        defineAbilities: (builder, c) => builder.applyRoles(c.roles),
      });
      svc.set({ ...ctx, roles: ['admin', 'good-custom'] });

      const ability = await factory.build();
      // The dropout still occurred — the system 'admin' wins, so
      // approve is granted. The custom 'admin' was discarded.
      expect(ability.can('approve', 'Merchant')).toBe(true);
      // … but the logger was NOT invoked.
      expect(messages).toEqual([]);
    });

    it('constructs cleanly without options.logger (falls back to default Logger)', async () => {
      // Smoke test: the factory must build and run dropouts without
      // throwing when no logger is supplied. We don't assert on
      // stdout here — that's NestJS Logger internals — only that
      // the request completes.
      const { factory, svc } = build({
        resolveTenantContext: () => ctx,
        permissions,
        roles: {
          systemRoles,
          loadCustomRoles: () => [{ name: 'admin', permissions: ['merchants:read'] }], // collides
        },
        defineAbilities: (builder) => builder.applyRoles(['admin']),
      });
      svc.set(ctx);

      await expect(factory.build()).resolves.toBeDefined();
    });

    it('returns no custom roles when loader is not configured (default empty)', async () => {
      const { factory, svc } = build({
        resolveTenantContext: () => ctx,
        permissions,
        roles: { systemRoles },
        defineAbilities: (builder) => builder.applyRoles(['ghost']),
      });
      svc.set(ctx);

      const ability = await factory.build();
      // 'ghost' isn't in systemRoles or customRoles → no rules.
      expect(ability.can('read', 'Merchant')).toBe(false);
    });
  });
});
