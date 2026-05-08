/**
 * Allocates unique parameter names for a single compilation pass.
 *
 * TypeORM's `QueryBuilder` uses named placeholders (`:foo`, `:bar`) and
 * collisions silently overwrite earlier values. The compiler must guarantee
 * every literal value gets a fresh name; the bag maintains a counter and
 * an optional prefix to namespace its keys against any pre-existing
 * parameters on the consumer's query builder.
 *
 * @example
 *   const bag = new ParameterBag('mtc');
 *   bag.next('alice');  // → ':mtc_0' bound to 'alice'
 *   bag.next(42);       // → ':mtc_1' bound to 42
 *   bag.snapshot();     // → { mtc_0: 'alice', mtc_1: 42 }
 */
export class ParameterBag {
  private readonly params: Record<string, unknown> = {};
  private counter = 0;

  constructor(private readonly prefix: string = 'mtc') {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(prefix)) {
      throw new Error(
        `Invalid ParameterBag prefix "${prefix}": must be a valid SQL parameter identifier.`,
      );
    }
  }

  /**
   * Allocate the next parameter name and store the value. Returns the
   * placeholder string ready to embed in SQL — `:mtc_N`.
   */
  next(value: unknown): string {
    const name = `${this.prefix}_${String(this.counter++)}`;
    this.params[name] = value;
    return `:${name}`;
  }

  /**
   * Like {@link ParameterBag.next}, but also returns the bare name (no
   * leading colon) so the caller can attach the value to a self-describing
   * {@link SqlFragment}. Operators use this form so each emitted fragment
   * carries the params it references — making fragment composition pure.
   */
  allocate(value: unknown): { readonly placeholder: string; readonly name: string } {
    const name = `${this.prefix}_${String(this.counter++)}`;
    this.params[name] = value;
    return { placeholder: `:${name}`, name };
  }

  /** Read-only snapshot of all bound parameters. */
  snapshot(): Readonly<Record<string, unknown>> {
    // Copy so the caller can't mutate the bag's internal state.
    return { ...this.params };
  }
}
