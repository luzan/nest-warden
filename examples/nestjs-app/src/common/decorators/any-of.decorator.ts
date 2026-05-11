import { applyDecorators } from '@nestjs/common';
import { CheckPolicies } from 'nest-warden/nestjs';
import type { AnyAbility } from '@casl/ability';

type PolicyHandler<TAbility extends AnyAbility> = (ability: TAbility) => boolean;

/**
 * Composes multiple policy handlers as a disjunction (OR). The route
 * is allowed if **any** of the handlers returns `true` against the
 * caller's ability. Useful when an endpoint accepts multiple
 * permission shapes and you'd rather express "this OR that" at the
 * decorator site than wire a custom guard.
 *
 *   @AnyOf(
 *     (a: AppAbility) => a.can('read', 'Payment'),
 *     (a: AppAbility) => a.can('manage', 'Payment'),
 *   )
 *
 * The library's `@CheckPolicies` already accepts multiple handlers
 * and combines them as AND (every handler must pass). `AnyOf`
 * wraps that into a single handler that returns true if any of the
 * inner handlers does — yielding OR semantics over the same primitive
 * without forking the library.
 */
export function AnyOf<TAbility extends AnyAbility>(
  ...handlers: ReadonlyArray<PolicyHandler<TAbility>>
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    CheckPolicies((ability: TAbility) => handlers.some((h) => h(ability))),
  );
}
