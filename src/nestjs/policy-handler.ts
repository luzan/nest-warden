import type { AnyAbility } from '@casl/ability';

/**
 * Object form of a policy handler.
 *
 * Implement this interface to encapsulate a permission check that can be
 * referenced from `@CheckPolicies(...)`. The handler receives the
 * per-request `ability` and the raw request (typed loosely as `unknown` —
 * cast inside the handler when you need framework specifics).
 *
 * @example
 *   export class CanReadMerchant implements PolicyHandler {
 *     handle(ability: AppAbility): boolean {
 *       return ability.can('read', 'Merchant');
 *     }
 *   }
 */
export interface PolicyHandler<TAbility extends AnyAbility = AnyAbility> {
  handle(ability: TAbility, request?: unknown): boolean;
}

/**
 * Inline-function form of a policy handler. Equivalent to a
 * {@link PolicyHandler} whose `handle` is the function body.
 *
 * @example
 *   @CheckPolicies((ability) => ability.can('read', 'Merchant'))
 */
export type PolicyHandlerFn<TAbility extends AnyAbility = AnyAbility> = (
  ability: TAbility,
  request?: unknown,
) => boolean;

/**
 * Either form is accepted by `@CheckPolicies(...)`; the guard normalizes
 * function handlers to the object form before invoking.
 */
export type PolicyHandlerLike<TAbility extends AnyAbility = AnyAbility> =
  | PolicyHandler<TAbility>
  | PolicyHandlerFn<TAbility>;

/** Type guard distinguishing object handlers from inline-function handlers. */
export function isPolicyHandlerObject<T extends AnyAbility>(
  h: PolicyHandlerLike<T>,
): h is PolicyHandler<T> {
  return typeof h === 'object' && h !== null && typeof h.handle === 'function';
}

/** Normalize either form to a function for uniform invocation. */
export function callPolicyHandler<T extends AnyAbility>(
  handler: PolicyHandlerLike<T>,
  ability: T,
  request?: unknown,
): boolean {
  if (isPolicyHandlerObject(handler)) {
    return handler.handle(ability, request);
  }
  return handler(ability, request);
}
