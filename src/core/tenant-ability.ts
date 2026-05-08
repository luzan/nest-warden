import {
  type AbilityTuple,
  type MongoAbility,
  type MongoQuery,
  createMongoAbility,
} from '@casl/ability';

/**
 * Public alias for the ability instances produced by `TenantAbilityBuilder`.
 *
 * It is structurally identical to CASL's `MongoAbility` — the tenant guarantee
 * is enforced at *build time* by the builder, not at the ability surface.
 * That keeps runtime checks zero-cost and lets the result be passed to any
 * code that accepts a CASL ability (UI gating, library helpers, etc.).
 */
export type TenantAbility<
  A extends AbilityTuple = AbilityTuple,
  C extends MongoQuery = MongoQuery,
> = MongoAbility<A, C>;

/**
 * Re-export of CASL's `createMongoAbility` for parity with consumers that
 * want to construct an ability from raw rules without going through the
 * builder. Note that ad-hoc rules created this way bypass the
 * `validateTenantRules` safeguard — prefer the builder for application code.
 */
export const createTenantAbility = createMongoAbility;
