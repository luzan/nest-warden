import { SetMetadata } from '@nestjs/common';
import type { AnyAbility } from '@casl/ability';
import { CHECK_POLICIES_KEY } from '../tokens.js';
import type { PolicyHandlerLike } from '../policy-handler.js';

/**
 * Attach one or more policy handlers to a route. Every handler must
 * return `true` for the request to proceed; a single `false` triggers
 * `ForbiddenException` from the guard.
 *
 * Handlers can be either object instances ({@link PolicyHandler}) or
 * inline arrow functions ({@link PolicyHandlerFn}). Use objects when the
 * check is reused across handlers; use functions for one-off checks.
 *
 * The generic parameter `TAbility` lets you narrow the handler argument
 * type to your application's specific ability — typically inferred from
 * the first handler:
 *
 * @example
 *   // Inline form — TS infers TAbility = AppAbility from the lambda.
 *   @CheckPolicies((ability: AppAbility) => ability.can('read', 'Merchant'))
 *   @Get('merchants')
 *   list() { ... }
 *
 *   // Object form (reusable, importable)
 *   @CheckPolicies(new CanApprovePayment())
 *   @Post('payments/:id/approve')
 *   approve() { ... }
 */
export const CheckPolicies = <TAbility extends AnyAbility = AnyAbility>(
  ...handlers: PolicyHandlerLike<TAbility>[]
): MethodDecorator => SetMetadata(CHECK_POLICIES_KEY, handlers);
