import type { DataSource } from 'typeorm';

/**
 * Two-tenant fixture exercising every relationship in the example schema.
 *
 *   tenant ACME (uuid 11111111-...)
 *     ├── agent alice (assigned to merchants m1, m2)
 *     ├── agent bob   (assigned to merchant m2)
 *     ├── merchant m1 (active)   — payments p1 ($50, captured),
 *     │                            p2 ($120, pending),
 *     │                            p5 ($80, authorized)
 *     ├── merchant m2 (pending)  — payments p3 ($75, captured),
 *     │                            p6 ($250, captured)
 *     └── merchant m3 (closed)   — no agents assigned
 *
 *   tenant BETA (uuid 22222222-...)
 *     ├── agent carol (assigned to merchant m4)
 *     └── merchant m4 (active)   — payment p4 ($99.99, authorized)
 *
 * The amount mix is deliberate: p1 / p3 / p5 sit under the
 * `cautious-refunder` 10 000-cent threshold, p2 / p6 sit above, and
 * p5 is the only authorized ACME payment for the capture-transition
 * scenario. p6 is captured (refund-eligible) and over the threshold —
 * exercises the negative-auth path without polluting earlier merchant
 * tests that ignore payment shapes.
 */
export const TENANT_ACME = '11111111-1111-1111-1111-111111111111';
export const TENANT_BETA = '22222222-2222-2222-2222-222222222222';

export const AGENT_ALICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001';
export const AGENT_BOB = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002';
export const AGENT_CAROL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003';

export const MERCHANT_M1 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001';
export const MERCHANT_M2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0002';
export const MERCHANT_M3 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0003';
export const MERCHANT_M4 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0004';

export const PAYMENT_P1 = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
export const PAYMENT_P2 = 'cccccccc-cccc-cccc-cccc-cccccccc0002';
export const PAYMENT_P3 = 'cccccccc-cccc-cccc-cccc-cccccccc0003';
export const PAYMENT_P4 = 'cccccccc-cccc-cccc-cccc-cccccccc0004';
export const PAYMENT_P5 = 'cccccccc-cccc-cccc-cccc-cccccccc0005';
export const PAYMENT_P6 = 'cccccccc-cccc-cccc-cccc-cccccccc0006';

export async function seedFixture(dataSource: DataSource): Promise<void> {
  // Use a system role / superuser for seeding; otherwise RLS would block
  // cross-tenant inserts. testcontainers Postgres makes the connecting
  // user the database owner, which auto-bypasses RLS — perfect for
  // setup. In production seeding you'd run as `app_admin`.
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.query(
      `INSERT INTO tenants(id, name) VALUES ($1, 'ACME ISO'), ($2, 'BETA ISO')`,
      [TENANT_ACME, TENANT_BETA],
    );

    await runner.query(
      `INSERT INTO agents(id, tenant_id, email, name) VALUES
       ($1, $2, 'alice@acme.test', 'Alice'),
       ($3, $2, 'bob@acme.test',   'Bob'),
       ($4, $5, 'carol@beta.test', 'Carol')`,
      [AGENT_ALICE, TENANT_ACME, AGENT_BOB, AGENT_CAROL, TENANT_BETA],
    );

    await runner.query(
      `INSERT INTO merchants(id, tenant_id, name, status) VALUES
       ($1, $2, 'Acme Coffee',     'active'),
       ($3, $2, 'Acme Plumbing',   'pending'),
       ($4, $2, 'Acme Closed',     'closed'),
       ($5, $6, 'Beta Bakery',     'active')`,
      [
        MERCHANT_M1, TENANT_ACME,
        MERCHANT_M2,
        MERCHANT_M3,
        MERCHANT_M4, TENANT_BETA,
      ],
    );

    await runner.query(
      `INSERT INTO agent_merchant_assignments(agent_id, merchant_id, tenant_id) VALUES
       ($1, $2, $5),
       ($1, $3, $5),
       ($4, $3, $5),
       ($6, $7, $8)`,
      [
        AGENT_ALICE, MERCHANT_M1, MERCHANT_M2, AGENT_BOB, TENANT_ACME,
        AGENT_CAROL, MERCHANT_M4, TENANT_BETA,
      ],
    );

    await runner.query(
      `INSERT INTO payments(id, tenant_id, merchant_id, amount_cents, status) VALUES
       ($1,  $2, $8, 5000,  'captured'),
       ($3,  $2, $8, 12000, 'pending'),
       ($4,  $2, $9, 7500,  'captured'),
       ($5,  $10, $11, 9999,  'authorized'),
       ($6,  $2, $8, 8000,  'authorized'),
       ($7,  $2, $9, 25000, 'captured')`,
      [
        PAYMENT_P1, TENANT_ACME,
        PAYMENT_P2,
        PAYMENT_P3,
        PAYMENT_P4,
        PAYMENT_P5,
        PAYMENT_P6,
        MERCHANT_M1,
        MERCHANT_M2,
        TENANT_BETA,
        MERCHANT_M4,
      ],
    );

    // Seed one tenant-managed custom role for ACME (RFC 001 Phase C).
    // Demonstrates the `loadCustomRoles` flow end-to-end: a non-
    // technical tenant admin would create this row through a UI in a
    // real product; the test uses raw SQL because the example doesn't
    // ship a custom-role management endpoint.
    await runner.query(
      `INSERT INTO custom_roles(tenant_id, name, description, permissions) VALUES
       ($1, 'tenant-auditor', 'Read-only access for QA reviewers',
        '["merchants:read"]'::jsonb)`,
      [TENANT_ACME],
    );
  } finally {
    await runner.release();
  }
}
