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
 * Authentication layer (`users` + `tenant_memberships`):
 *
 *   - alice, bob, carol each have one membership in their own tenant.
 *     Their `users.id` is the SAME uuid as their `agents.id` to keep
 *     the cross-references readable; production schemas usually keep
 *     these distinct.
 *   - pat (uuid dddd...) is a platform-admin with memberships in
 *     BOTH tenants. Used by E2E to exercise the cross-tenant claim
 *     check — a token for pat with `tenantId: ACME` resolves
 *     differently from a token for pat with `tenantId: BETA`.
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

// Auth-layer user identifiers. Alice/Bob/Carol reuse their agent UUIDs
// for cross-reference clarity. Every other user exists only in the
// auth layer with a single membership pinning exactly one role — the
// E2E tests rely on role-isolation, so giving a single user multiple
// roles would muddle assertions about which rule emitted which
// result. Beth is the exception: she's the multi-role merge fixture
// (`['agent', 'merchant-approver']`) and also has an `agents` row so
// the agent rule's `$relatedTo` lookup succeeds.
//
// Pat is the cross-tenant fixture: memberships in BOTH ACME (as
// iso-admin) and BETA (as merchant-viewer-public). He's what makes
// the JWT trust-boundary check observable — minting two tokens for
// the same `sub` with different `tenantId` claims puts him under
// two different rule sets.
export const USER_ALICE = AGENT_ALICE;
export const USER_BOB = AGENT_BOB;
export const USER_CAROL = AGENT_CAROL;

export const USER_BETH = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004';
export const USER_PAT = 'dddddddd-dddd-dddd-dddd-dddddddd0001';

export const USER_ISO_ADMIN_ACME = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
export const USER_PLATFORM_ADMIN_ACME = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0002';
export const USER_MERCHANT_APPROVER_ACME = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0003';
export const USER_MERCHANT_APPROVER_BETA = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0004';
export const USER_CAUTIOUS_APPROVER_ACME = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0005';
export const USER_MERCHANT_VIEWER_ACME = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0006';
export const USER_TENANT_AUDITOR_ACME = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0007';
export const USER_TENANT_AUDITOR_BETA = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0008';
export const USER_PAYMENT_APPROVER_ACME = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0009';
export const USER_CAUTIOUS_REFUNDER_ACME = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0010';

// A user with NO memberships — used by the JWT guard test to assert
// that a valid token whose `sub` has no row in `tenant_memberships`
// for the claimed `tenantId` is rejected with 403.
export const USER_STRANGER = 'ffffffff-ffff-ffff-ffff-ffffffff0001';

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
       ($4, $5, 'carol@beta.test', 'Carol'),
       ($6, $2, 'beth@acme.test',  'Beth')`,
      [AGENT_ALICE, TENANT_ACME, AGENT_BOB, AGENT_CAROL, TENANT_BETA, USER_BETH],
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
       ($6, $7, $8),
       ($9, $2, $5)`,
      [
        AGENT_ALICE, MERCHANT_M1, MERCHANT_M2, AGENT_BOB, TENANT_ACME,
        AGENT_CAROL, MERCHANT_M4, TENANT_BETA,
        USER_BETH,
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

    // Auth-layer seed. Each test scenario gets a dedicated user with
    // exactly one role-shape per tenant. The Stranger user has no
    // memberships at all — the JWT guard test uses him to exercise
    // the 403 path. See the comment block above the USER_* constants
    // for the design rationale.
    await runner.query(
      `INSERT INTO users(id, email, name) VALUES
       ($1,  'alice@acme.test',                 'Alice'),
       ($2,  'bob@acme.test',                   'Bob'),
       ($3,  'carol@beta.test',                 'Carol'),
       ($4,  'beth@acme.test',                  'Beth'),
       ($5,  'pat@platform.test',               'Pat'),
       ($6,  'iso-admin-acme@example.test',     'ISO Admin (ACME)'),
       ($7,  'platform-admin@example.test',    'Platform Admin'),
       ($8,  'merch-approver-acme@example.test','Merchant Approver (ACME)'),
       ($9,  'merch-approver-beta@example.test','Merchant Approver (BETA)'),
       ($10, 'cautious-approver@example.test',  'Cautious Approver'),
       ($11, 'merchant-viewer@example.test',    'Merchant Viewer'),
       ($12, 'auditor-acme@example.test',       'Tenant Auditor (ACME)'),
       ($13, 'auditor-beta@example.test',       'Tenant Auditor (BETA)'),
       ($14, 'payment-approver@example.test',   'Payment Approver'),
       ($15, 'cautious-refunder@example.test',  'Cautious Refunder'),
       ($16, 'stranger@example.test',           'Stranger (no memberships)')`,
      [
        USER_ALICE,
        USER_BOB,
        USER_CAROL,
        USER_BETH,
        USER_PAT,
        USER_ISO_ADMIN_ACME,
        USER_PLATFORM_ADMIN_ACME,
        USER_MERCHANT_APPROVER_ACME,
        USER_MERCHANT_APPROVER_BETA,
        USER_CAUTIOUS_APPROVER_ACME,
        USER_MERCHANT_VIEWER_ACME,
        USER_TENANT_AUDITOR_ACME,
        USER_TENANT_AUDITOR_BETA,
        USER_PAYMENT_APPROVER_ACME,
        USER_CAUTIOUS_REFUNDER_ACME,
        USER_STRANGER,
      ],
    );
    await runner.query(
      `INSERT INTO tenant_memberships(user_id, tenant_id, roles) VALUES
       ($1,  $16::uuid, '["agent"]'::jsonb),
       ($2,  $16::uuid, '["agent"]'::jsonb),
       ($3,  $17::uuid, '["agent"]'::jsonb),
       ($4,  $16::uuid, '["agent","merchant-approver"]'::jsonb),
       ($5,  $16::uuid, '["iso-admin"]'::jsonb),
       ($5,  $17::uuid, '["merchant-viewer-public"]'::jsonb),
       ($6,  $16::uuid, '["iso-admin"]'::jsonb),
       ($7,  $16::uuid, '["platform-admin"]'::jsonb),
       ($8,  $16::uuid, '["merchant-approver"]'::jsonb),
       ($9,  $17::uuid, '["merchant-approver"]'::jsonb),
       ($10, $16::uuid, '["cautious-approver"]'::jsonb),
       ($11, $16::uuid, '["merchant-viewer-public"]'::jsonb),
       ($12, $16::uuid, '["tenant-auditor"]'::jsonb),
       ($13, $17::uuid, '["tenant-auditor"]'::jsonb),
       ($14, $16::uuid, '["payment-approver"]'::jsonb),
       ($15, $16::uuid, '["cautious-refunder"]'::jsonb)`,
      [
        USER_ALICE,
        USER_BOB,
        USER_CAROL,
        USER_BETH,
        USER_PAT,
        USER_ISO_ADMIN_ACME,
        USER_PLATFORM_ADMIN_ACME,
        USER_MERCHANT_APPROVER_ACME,
        USER_MERCHANT_APPROVER_BETA,
        USER_CAUTIOUS_APPROVER_ACME,
        USER_MERCHANT_VIEWER_ACME,
        USER_TENANT_AUDITOR_ACME,
        USER_TENANT_AUDITOR_BETA,
        USER_PAYMENT_APPROVER_ACME,
        USER_CAUTIOUS_REFUNDER_ACME,
        TENANT_ACME,
        TENANT_BETA,
      ],
    );
  } finally {
    await runner.release();
  }
}
