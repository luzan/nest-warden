import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Scope,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AnyAbility } from '@casl/ability';
import { callPolicyHandler, type PolicyHandlerLike } from '../policy-handler.js';
import type { TenantAbilityModuleOptions } from '../options.js';
import { TenantAbilityFactory } from '../tenant-ability.factory.js';
import { TenantContextService } from '../tenant-context.service.js';
import { CHECK_POLICIES_KEY, IS_PUBLIC_KEY, MTC_OPTIONS } from '../tokens.js';

/**
 * Enforces `@CheckPolicies(...)` on every route. Builds the per-request
 * ability via {@link TenantAbilityFactory}, runs each policy handler, and
 * throws `ForbiddenException` if any returns `false`.
 *
 * Skipped (returns `true`) when:
 *
 *   - The route is marked `@Public()`.
 *   - The route has no `@CheckPolicies(...)` decorator (i.e., no policy
 *     handlers attached). This is a deliberate "policies are opt-in"
 *     contract — routes without policies are NOT auto-denied. Combine
 *     with a separate JWT/auth guard to ensure unauthenticated requests
 *     never reach the controller.
 *
 * The built ability is exposed at `request.ability` so downstream code
 * (services, response interceptors) can re-check without rebuilding.
 *
 * IMPORTANT — guard self-sufficiency:
 *
 *   The guard lazy-resolves the tenant context via the configured
 *   `resolveTenantContext` callback if `TenantContextService` isn't yet
 *   populated. NestJS runs guards BEFORE interceptors in the request
 *   lifecycle, so depending on `TenantContextInterceptor` to populate
 *   the context first does NOT work — guard would always see an empty
 *   context. The interceptor remains as an explicit hook for
 *   middleware-style consumers that don't go through the policies guard.
 *
 *   See `examples/nestjs-app/FINDINGS.md` § 4.
 *
 * REQUEST-scoped to chain with the REQUEST-scoped {@link TenantAbilityFactory}.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantPoliciesGuard<TAbility extends AnyAbility = AnyAbility> implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TenantAbilityFactory)
    private readonly abilityFactory: TenantAbilityFactory<TAbility>,
    @Inject(TenantContextService)
    // Concrete TId is irrelevant inside the guard — we never inspect the
    // value, just pass it through. Use `any` here to satisfy the
    // invariant generic position; the public API still narrows TId at
    // module-config time.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly contextService: TenantContextService<any>,
    @Inject(MTC_OPTIONS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly options: TenantAbilityModuleOptions<TAbility, any>,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    if (this.isPublic(executionContext)) return true;

    const handlers =
      this.reflector.get<PolicyHandlerLike<TAbility>[]>(
        CHECK_POLICIES_KEY,
        executionContext.getHandler(),
      ) ?? [];

    if (handlers.length === 0) return true;

    const request = executionContext
      .switchToHttp()
      .getRequest<{ ability?: TAbility; tenantContext?: unknown }>();

    // NestJS runs guards BEFORE interceptors, so the
    // `TenantContextInterceptor` hasn't yet populated the context. Lazily
    // resolve it here — making the guard self-sufficient. The interceptor
    // becomes redundant for the policy-gated path and exists primarily as
    // an explicit hook for middleware-style consumers.
    if (!this.contextService.has()) {
      const resolved = await this.options.resolveTenantContext(request);
      this.contextService.set(resolved);
      request.tenantContext = resolved;
    }

    const ability = await this.abilityFactory.build(request);
    request.ability = ability;

    const allowed = handlers.every((handler) => callPolicyHandler(handler, ability, request));
    if (!allowed) {
      throw new ForbiddenException(
        'You do not have sufficient permission to perform this action.',
      );
    }
    return true;
  }

  private isPublic(executionContext: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        executionContext.getHandler(),
        executionContext.getClass(),
      ]) === true
    );
  }
}
