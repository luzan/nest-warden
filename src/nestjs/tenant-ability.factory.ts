import { Inject, Injectable, Scope } from '@nestjs/common';
import { type AnyAbility, createMongoAbility } from '@casl/ability';
import { TenantAbilityBuilder } from '../core/tenant-ability.builder.js';
import type { TenantIdValue } from '../core/tenant-id.js';
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
   */
  async build(request?: unknown): Promise<TAbility> {
    const context = this.contextService.get();
    const builder = new TenantAbilityBuilder<TAbility, TId>(
      this.options.abilityClass ?? createMongoAbility,
      context,
      {
        tenantField: this.options.tenantField,
        validateRules: this.options.validateRulesAtBuild,
      },
    );
    await this.options.defineAbilities(builder, context, request);
    return builder.build();
  }
}
