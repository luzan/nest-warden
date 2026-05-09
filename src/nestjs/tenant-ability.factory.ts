import { Inject, Injectable, Scope } from '@nestjs/common';
import { type AnyAbility, createMongoAbility } from '@casl/ability';
import { TenantAbilityBuilder } from '../core/tenant-ability.builder.js';
import type { TenantIdValue } from '../core/tenant-id.js';
import {
  type CustomRoleEntry,
  assertNoSystemRoleCollision,
  validatePermissionReferences,
} from '../core/permissions/index.js';
import type { TenantAbilityModuleOptions } from './options.js';
import { TenantContextService } from './tenant-context.service.js';
import { MTC_OPTIONS } from './tokens.js';

/**
 * Builds the per-request CASL {@link TenantAbility} from the consumer's
 * `defineAbilities` callback.
 *
 * Each request gets its own ability instance — there is no caching across
 * requests, by design. Roles/memberships can change between requests
 * (membership revoked, role downgraded), so a per-request build keeps the
 * ability authoritative without stale-cache hazards.
 *
 * The factory is REQUEST-scoped because it depends on the REQUEST-scoped
 * {@link TenantContextService}. The ability it produces, however, is just
 * a regular object — store it on `request.ability` if you want to share
 * it across guards/interceptors/services within the same request.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantAbilityFactory<
  TAbility extends AnyAbility = AnyAbility,
  TId extends TenantIdValue = string,
> {
  constructor(
    @Inject(MTC_OPTIONS) private readonly options: TenantAbilityModuleOptions<TAbility, TId>,
    @Inject(TenantContextService) private readonly contextService: TenantContextService<TId>,
  ) {}

  /**
   * Build the ability for the current request. Pass the raw request so
   * `defineAbilities` can branch on request properties (path, method,
   * etc.) when needed.
   *
   * If `loadCustomRoles` is configured, the factory invokes it once
   * here and validates each returned role:
   *
   *   - A custom role whose `name` collides with a system role is
   *     dropped (the system role wins) and a warning is logged.
   *   - A custom role referencing an unknown permission is dropped
   *     and a warning is logged.
   *
   * Validation is fail-closed by design — a misconfigured row in the
   * tenant's custom-roles table should not cause every request from
   * that tenant to error out. Surface the misconfiguration via logs
   * and let the request continue with the surviving roles.
   */
  async build(request?: unknown): Promise<TAbility> {
    const context = this.contextService.get();
    const customRoles = await this.loadAndValidateCustomRoles(context);

    const builder = new TenantAbilityBuilder<TAbility, TId>(
      this.options.abilityClass ?? createMongoAbility,
      context,
      {
        tenantField: this.options.tenantField,
        validateRules: this.options.validateRulesAtBuild,
        permissions: this.options.permissions,
        systemRoles: this.options.systemRoles,
        customRoles,
      },
    );
    await this.options.defineAbilities(builder, context, request);
    return builder.build();
  }

  private async loadAndValidateCustomRoles(
    context: ReturnType<TenantContextService<TId>['get']>,
  ): Promise<readonly CustomRoleEntry[]> {
    const loader = this.options.loadCustomRoles;
    if (!loader) return [];

    const raw = await loader(context.tenantId, context);
    const permissions = this.options.permissions;
    const systemRoles = this.options.systemRoles;
    const surviving: CustomRoleEntry[] = [];

    for (const role of raw) {
      // Collision: drop + warn.
      if (systemRoles) {
        try {
          assertNoSystemRoleCollision(systemRoles, role.name);
        } catch (err) {
          console.warn(
            `[nest-warden] Dropping custom role "${role.name}" for tenant ` +
              `"${String(context.tenantId)}" because it collides with a system ` +
              `role of the same name. The system role wins. ` +
              `(${String(err)})`,
          );
          continue;
        }
      }
      // Unknown permission references: drop + warn.
      if (permissions) {
        try {
          validatePermissionReferences(permissions, role.name, role.permissions);
        } catch (err) {
          console.warn(
            `[nest-warden] Dropping custom role "${role.name}" for tenant ` +
              `"${String(context.tenantId)}" because it references an ` +
              `unknown permission. ` +
              `(${String(err)})`,
          );
          continue;
        }
      }
      surviving.push({
        name: role.name,
        permissions: role.permissions,
        description: role.description,
      });
    }

    return surviving;
  }
}
