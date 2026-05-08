/**
 * Shared test fixtures: typed subject shapes and helpers.
 *
 * Note on typing: we use the open `MongoAbility` (no narrowed generic tuple)
 * here so test rule definitions can reference resource fields and subject
 * objects without fighting CASL's overload narrowing. Production code SHOULD
 * narrow the ability tuple to specific Action/Subject types — see the
 * NestJS example app for that pattern.
 */
import type { MongoAbility } from '@casl/ability';

export interface Merchant {
  readonly kind: 'Merchant';
  readonly id: string;
  readonly tenantId: string;
  readonly orgId?: string;
  readonly agentId?: string;
  readonly status?: 'active' | 'pending' | 'inactive' | 'closed';
  readonly name?: string;
}

export interface Payment {
  readonly kind: 'Payment';
  readonly id: string;
  readonly tenantId: string;
  readonly merchantId: string;
  readonly amountCents: number;
  readonly status?: 'pending' | 'authorized' | 'captured' | 'refunded';
}

export interface Agent {
  readonly kind: 'Agent';
  readonly id: string;
  readonly tenantId: string;
}

/**
 * Open ability surface. For test code we want runtime checks, not narrowed
 * IDE types. Treats both subject classes-by-string and tagged instances as
 * valid arguments to `can`.
 */
export type AppAbility = MongoAbility;

/**
 * Type-safe constructors that tag the resulting object with both `kind`
 * (TypeScript discriminant) and `__caslSubjectType__` (CASL runtime
 * detection). Without the latter, CASL's `detectSubjectType` falls back
 * to `constructor.name` ("Object" for plain literals) and rule lookup
 * misses entirely.
 */
const tagSubject = <T extends object>(obj: T, type: string): T =>
  Object.assign({ __caslSubjectType__: type }, obj);

export const asMerchant = (props: Omit<Merchant, 'kind'>): Merchant =>
  tagSubject({ ...props, kind: 'Merchant' as const }, 'Merchant');
export const asPayment = (props: Omit<Payment, 'kind'>): Payment =>
  tagSubject({ ...props, kind: 'Payment' as const }, 'Payment');
export const asAgent = (props: Omit<Agent, 'kind'>): Agent =>
  tagSubject({ ...props, kind: 'Agent' as const }, 'Agent');
