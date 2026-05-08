import { RelationshipGraph, foreignKey, joinTable } from 'nest-warden';

/**
 * The application's data relationships. Defined once at module bootstrap
 * and shared across all requests.
 *
 *   Payment → Merchant via FK `payments.merchant_id`
 *   Merchant → Agent via M:N junction `agent_merchant_assignments`
 *
 * Combined: Payment → Merchant → Agent gives a 2-hop path that
 * `accessibleBy(...)` compiles into a single EXISTS subquery.
 */
export const relationshipGraph = new RelationshipGraph()
  .define({
    name: 'merchant_of_payment',
    from: 'Payment',
    to: 'Merchant',
    resolver: foreignKey({
      fromColumn: 'merchant_id',
      toColumn: 'id',
      fromTable: 'payments',
      toTable: 'merchants',
    }),
  })
  .define({
    name: 'agents_of_merchant',
    from: 'Merchant',
    to: 'Agent',
    resolver: joinTable({
      table: 'agent_merchant_assignments',
      fromKey: 'merchant_id',
      toKey: 'agent_id',
    }),
  });
