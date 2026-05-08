import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  Scope,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import type { TenantIdValue } from '../core/tenant-id.js';
import type { TenantAbilityModuleOptions } from './options.js';
import { TenantContextService } from './tenant-context.service.js';
import { IS_PUBLIC_KEY, MTC_OPTIONS } from './tokens.js';

/**
 * Resolves the request-scoped {@link TenantContext} once per authenticated
 * request and stores it on:
 *
 *   1. {@link TenantContextService} (the canonical source for downstream
 *      services).
 *   2. `request.tenantContext` (for `@CurrentTenant()` param decorator).
 *
 * Skipped automatically when:
 *
 *   - The route is marked `@Public()` (via the `IS_PUBLIC_KEY` reflector
 *     metadata).
 *   - The configured `isPublic(executionContext)` predicate returns `true`.
 *
 * The resolver is the consumer's `resolveTenantContext` from module
 * options. It MUST perform a server-side membership lookup, not trust
 * client claims directly — see the JSDoc on
 * {@link TenantAbilityModuleOptions.resolveTenantContext}.
 *
 * Fail-closed: any error from the resolver propagates as-is, denying the
 * request. This is intentional — the safer default than accidentally
 * proceeding with a stale or absent context.
 *
 * REQUEST-scoped because it depends on the REQUEST-scoped
 * {@link TenantContextService}. NestJS handles the per-request
 * instantiation transparently when the interceptor is registered as
 * APP_INTERCEPTOR.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextInterceptor<TId extends TenantIdValue = string>
  implements NestInterceptor
{
  constructor(
    @Inject(MTC_OPTIONS) private readonly options: TenantAbilityModuleOptions<never, TId>,
    @Inject(TenantContextService) private readonly contextService: TenantContextService<TId>,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (this.shouldSkip(executionContext)) {
      return next.handle();
    }

    const request = executionContext.switchToHttp().getRequest<Record<string, unknown>>();
    const tenantContext = await this.options.resolveTenantContext(request);

    this.contextService.set(tenantContext);
    // Mirror onto the request so the `@CurrentTenant()` param decorator
    // (which has no DI access) can read the value off the raw request.
    request.tenantContext = tenantContext;

    return next.handle();
  }

  private shouldSkip(executionContext: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (isPublic === true) return true;
    if (this.options.isPublic?.(executionContext) === true) return true;
    return false;
  }
}
