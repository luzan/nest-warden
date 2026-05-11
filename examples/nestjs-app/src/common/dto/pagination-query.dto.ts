/**
 * `PaginationQuery` is a shared shape for `?limit=` / `?offset=`
 * pagination across feature modules. Lives in `common/` so that
 * `/merchants` and `/payments` (and any later module) all interpret
 * the query string the same way.
 *
 * Two invariants the DTO enforces, neither of which Nest's query
 * parser does for you:
 *
 *   1. **Clamp `limit` to a sane range.** A client can't force a
 *      full-table scan by passing `?limit=1000000`, and `?limit=0`
 *      doesn't silently return zero rows — both collapse to the
 *      module's default.
 *   2. **Coerce `offset` to a non-negative integer.** Negative offsets
 *      reach back to the start; non-numeric values fall through to 0.
 *
 * The class-validator + class-transformer combo would let us do
 * the same with decorators, but the example deliberately avoids
 * pulling them in to keep the dependency footprint readable. A real
 * consumer can drop in the decorators — the contract this DTO
 * presents (`{ limit, offset }`) stays identical.
 */
export interface PaginationQueryDefaults {
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

const FALLBACK_DEFAULTS: PaginationQueryDefaults = {
  defaultLimit: 25,
  maxLimit: 100,
};

export interface ResolvedPagination {
  readonly limit: number;
  readonly offset: number;
}

/**
 * Parses raw query-string values into a normalized
 * {@link ResolvedPagination}. Express delivers query values as
 * `string | string[] | undefined`; this helper accepts that shape
 * and is total — every input produces a well-defined output.
 */
export function resolvePagination(
  raw: {
    limit?: string | string[];
    offset?: string | string[];
  },
  defaults: PaginationQueryDefaults = FALLBACK_DEFAULTS,
): ResolvedPagination {
  const limit = clampLimit(firstString(raw.limit), defaults);
  const offset = clampOffset(firstString(raw.offset));
  return { limit, offset };
}

function firstString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function clampLimit(raw: string | undefined, defaults: PaginationQueryDefaults): number {
  if (raw === undefined) return defaults.defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaults.defaultLimit;
  if (parsed > defaults.maxLimit) return defaults.maxLimit;
  return parsed;
}

function clampOffset(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}
