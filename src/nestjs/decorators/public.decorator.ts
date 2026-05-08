import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../tokens.js';

/**
 * Marks a route handler (or controller class) as public — bypassing the
 * tenant interceptor and policies guard entirely. Use sparingly: only
 * truly public endpoints (health checks, sign-up forms, public pricing)
 * belong here.
 *
 * Routes marked `@Public()` will NOT have a `TenantContext` available;
 * any service that injects {@link TenantContextService} and calls `.get()`
 * inside a public handler will throw {@link MissingTenantContextError}.
 *
 * @example
 *   @Public()
 *   @Get('health')
 *   health() { return { ok: true }; }
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
