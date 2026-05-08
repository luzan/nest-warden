import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { MissingTenantContextError } from '../../core/errors.js';
import type { TenantContext } from '../../core/tenant-context.js';

/**
 * Factory function used by `@CurrentTenant()`. Exported separately so
 * unit tests can exercise it without spinning up a NestJS testing module.
 *
 * Resolves the tenant context from `request.tenantContext` (populated by
 * `TenantContextInterceptor`), throws `MissingTenantContextError` if
 * absent, and returns either the full context or a single field when
 * `data` is specified.
 */
export function currentTenantFactory(
  data: keyof TenantContext | undefined,
  ctx: ExecutionContext,
): unknown {
  const request = ctx.switchToHttp().getRequest<{ tenantContext?: TenantContext }>();
  const tenantContext = request.tenantContext;
  if (!tenantContext) {
    throw new MissingTenantContextError(
      '@CurrentTenant() used on a route that has no tenant context. ' +
        'Ensure the route is not @Public() and that TenantContextInterceptor is registered.',
    );
  }
  if (data === undefined) return tenantContext;
  return tenantContext[data];
}

/**
 * Parameter decorator that injects the resolved {@link TenantContext}
 * into a controller method.
 *
 * The context is read from `request.tenantContext`, which the
 * `TenantContextInterceptor` populates after a successful resolve. On a
 * `@Public()` route the interceptor is skipped, so the property is
 * absent — accessing `@CurrentTenant()` from a public handler throws.
 *
 * @example
 *   @Get('me/tenant')
 *   me(@CurrentTenant() ctx: TenantContext) {
 *     return { tenantId: ctx.tenantId, roles: ctx.roles };
 *   }
 *
 *   // Pass `'tenantId'` to extract a single field:
 *   @Get('me/id')
 *   id(@CurrentTenant('tenantId') tenantId: string) {
 *     return { tenantId };
 *   }
 */
export const CurrentTenant = createParamDecorator(currentTenantFactory);
