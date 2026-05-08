---
title: TypeORM Integration
---

The `nest-warden/typeorm` module ships everything needed to connect
nest-warden to a TypeORM data source: the
[`accessibleBy()`](/docs/core-concepts/forward-vs-reverse/) reverse-
lookup adapter, a `TenantAwareRepository` wrapper, the
`@TenantColumn()` decorator, a `TenantSubscriber` that auto-stamps
inserts, and an RLS session helper.

## Mark your tenant column

```ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { TenantColumn } from 'nest-warden/typeorm';

@Entity('merchants')
export class Merchant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'tenant_id' })
  @TenantColumn()
  tenantId!: string;

  @Column('text')
  name!: string;
}
```

`@TenantColumn()` is purely a marker — it does not configure the
column. Combine it with TypeORM's `@Column()` as usual. Each entity
may have at most one `@TenantColumn`; declaring two throws at module
load time.

The library reads this metadata from:
- `TenantSubscriber` (to stamp `tenantId` on insert and verify on update)
- `TenantAwareRepository` (to inject the predicate into auto-generated
  WHERE clauses)
- `accessibleBy()` (does NOT read it — uses `tenantField` from module
  options instead, since the column might not be on the queried entity)

## `accessibleBy()` for listing endpoints

```ts
import { accessibleBy } from 'nest-warden/typeorm';

@Injectable({ scope: Scope.REQUEST })
export class MerchantsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TenantAbilityFactory)
    private readonly abilityFactory: TenantAbilityFactory<AppAbility>,
  ) {}

  async findAll(): Promise<Merchant[]> {
    const ability = await this.abilityFactory.build();
    const qb = this.dataSource.getRepository(Merchant).createQueryBuilder('m');
    accessibleBy(ability, 'read', 'Merchant', {
      alias: 'm',
      graph: relationshipGraph,
    }).applyTo(qb);
    return qb.take(50).getMany();
  }
}
```

The `applyTo(qb)` call appends a single `andWhere` containing the
compiled SQL fragment. Compose with your own `andWhere`, `orderBy`,
`take`, etc. as usual.

### Without applyTo

For consumers building queries outside TypeORM's QueryBuilder:

```ts
import { buildAccessibleSql } from 'nest-warden/typeorm';

const fragment = buildAccessibleSql(ability, 'read', 'Merchant', { alias: 'm', graph });
// → { sql: 'm.tenantId = :mtc_0 AND ...', params: { mtc_0: 't1', ... } } | null
```

The fragment is `null` when no rule grants access. The `applyTo`
helper turns `null` into `1 = 0` (deny everything) so the resulting
query returns no rows — fail-closed.

### Parameter prefix

If `mtc_*` collides with parameters your QueryBuilder already uses:

```ts
accessibleBy(ability, 'read', 'Merchant', {
  alias: 'm',
  graph,
  parameterPrefix: 'auth',  // → :auth_0, :auth_1, ...
}).applyTo(qb);
```

## `TenantAwareRepository` for service-layer queries

A thin wrapper over TypeORM's `Repository<T>` that auto-applies
`WHERE tenantId = :resolvedTenant` on every find/findBy/findOne/etc.
Useful for code paths that don't go through `accessibleBy()` but
should still be tenant-scoped.

```ts
import { TenantAwareRepository } from 'nest-warden/typeorm';

@Injectable({ scope: Scope.REQUEST })
export class MerchantsService {
  private readonly merchants: TenantAwareRepository<Merchant>;

  constructor(
    @InjectDataSource() ds: DataSource,
    @Inject(TenantContextService) tenantContext: TenantContextService,
  ) {
    this.merchants = new TenantAwareRepository(
      ds.getRepository(Merchant),
      () => tenantContext.tenantId,
    );
  }

  async findAll() {
    // Auto-scoped: WHERE tenantId = <ctx.tenantId>
    return this.merchants.find({ where: { status: 'active' } });
  }
}
```

`TenantAwareRepository` covers `find`, `findOne`, `findBy`, `findOneBy`,
`findAndCount`, `count`, `save`, and `createQueryBuilder`. For
operations not on the wrapper, drop down to `repo.repository` (the
underlying TypeORM repo) and call `repo.scopeWhere(...)` /
`repo.scopeQueryBuilder(...)` manually.

## Updates and deletes

Writes follow a **load-then-check-then-persist** pattern. The library
gives you three layers of defense; use all three for non-trivial
mutations:

```ts
async update(id: string, partial: Partial<Merchant>): Promise<Merchant> {
  const ability = await this.abilityFactory.build();
  const repo = this.dataSource.getRepository(Merchant);

  // 1. Tenant-scoped load. Cross-tenant IDs surface as 404, not as
  //    authorization errors — existence is never leaked.
  const merchant = await repo.findOne({
    where: { id, tenantId: this.tenantContext.tenantId },
  });
  if (!merchant) throw new NotFoundException(`Merchant ${id} not found.`);

  // 2. Forward authorization check. Required for rules with row-level
  //    conditions; the policy guard alone gates by (action, subject)
  //    without seeing the loaded row.
  if (!ability.can('update', { ...merchant, __caslSubjectType__: 'Merchant' } as never)) {
    throw new NotFoundException(`Merchant ${id} not found.`);
  }

  // 3. Persist. `TenantSubscriber.beforeUpdate` runs as defense in
  //    depth: if the loaded row's `tenantId` no longer matches the
  //    active tenant context (e.g., context mutated mid-request), the
  //    subscriber refuses the write.
  Object.assign(merchant, partial);
  return repo.save(merchant);
}
```

`delete` follows the same shape — load with tenant filter, forward
check `ability.can('delete', merchant)`, then `repo.remove(merchant)`.
For soft delete via `@DeleteDateColumn`, see the roadmap entry that
covers the interaction with `accessibleBy()`.

{% callout type="warning" title="Don't bypass the load step" %}
Calling `repo.update({ id }, partial)` without first loading the row
skips both the existence check and the forward authorization check.
The subscriber's `beforeUpdate` still defends against cross-tenant
writes, but the row will silently be a no-op for cross-tenant IDs
rather than raising 404.
{% /callout %}

### Soft delete via `@DeleteDateColumn`

For audit-friendly deletes, mark a column on the entity:

```ts
import { DeleteDateColumn } from 'typeorm';

@Entity('merchants')
export class Merchant {
  // ... id, tenantId, etc.

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date | null;
}
```

In the service, swap `repo.remove(entity)` for `repo.softRemove(entity)`:

```ts
await repo.softRemove(merchant);
// → UPDATE merchants SET deleted_at = NOW() WHERE id = $1
```

TypeORM auto-applies `WHERE deletedAt IS NULL` to every read on the
entity — `find()`, `findOne()`, and `createQueryBuilder().getMany()`
all skip soft-deleted rows by default. The `accessibleBy()`
predicate composes via AND, so the authorization check and tenant
predicate still apply when soft-deleted rows are surfaced.

To include them, opt in on the QueryBuilder:

```ts
const qb = repo.createQueryBuilder('m').withDeleted();
accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph }).applyTo(qb);
const all = await qb.getMany(); // includes soft-deleted rows
```

The composed SQL becomes roughly:

```sql
WHERE m.tenantId = $1
  AND <auth fragment>
-- (no `deletedAt IS NULL` clause)
```

{% callout type="note" title="Soft delete and RLS" %}
Postgres RLS policies see only the rows their `USING` clause
permits, regardless of `deletedAt`. A soft-deleted row from another
tenant is still excluded by the tenant policy. Soft delete and RLS
operate on independent dimensions; both compose into the final
query plan via AND.
{% /callout %}

### Why the policy guard alone isn't enough

`@CheckPolicies(...)` runs **before** the controller method, so the
ability is checked against the action and subject TYPE, not the
specific row. For rules like
`can('approve', 'Merchant', { status: 'pending' })`, the guard sees
only the rule's existence, not whether the loaded merchant's status
actually matches. The forward check inside the service is what binds
the rule's conditions to the concrete row.

## Auto-stamping inserts via `TenantSubscriber`

Register the subscriber on your data source:

```ts
import { DataSource } from 'typeorm';
import { TenantSubscriber } from 'nest-warden/typeorm';

const dataSource = new DataSource({
  type: 'postgres',
  // ...
  subscribers: [new TenantSubscriber(() => tenantContext.tenantId)],
});
```

Behavior:

- **`beforeInsert`:** if `@TenantColumn` is empty, stamp it from the
  resolver. If it's already set to a different value, throw —
  prevents forged inputs from creating cross-tenant rows.
- **`beforeUpdate`:** if the new value differs from the active tenant,
  throw. If the loaded DB row's tenant differs from the active
  tenant, throw — prevents cross-tenant updates via raw repository
  calls.
- Entities without `@TenantColumn` pass through untouched.

## RLS session helper

For Postgres row-level-security policies that read
`current_setting('app.current_tenant_id')`, the library ships a
`buildRlsSet(tenantId)` helper:

```ts
import { buildRlsSet } from 'nest-warden/typeorm';

const [sql, params] = buildRlsSet(tenantId);
await queryRunner.query(sql, [...params]);
// → SET via set_config('app.current_tenant_id', $1, true)
```

The library uses `set_config(...)` rather than `SET LOCAL` because
Postgres rejects bound parameters in the value position of a `SET`
statement — see [Postgres RLS guide](/docs/integration/rls-postgres/)
for the full pattern.

For automatic per-request invocation, register
`RlsTransactionInterceptor` on your NestJS app (see [Postgres RLS
guide](/docs/integration/rls-postgres/)).

## Type-safety with TypeORM entity types

TypeScript inference works through `accessibleBy()` if your CASL
ability is typed:

```ts
type AppAbility = MongoAbility<[AppAction, AppSubject]>;
const ability: AppAbility = await abilityFactory.build();
accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph });
//          ↑ string actions / subjects autocomplete from AppAbility
```

The compiled SQL fragment is opaque from TypeScript's perspective —
once `applyTo(qb)` runs, the QueryBuilder is just a regular TypeORM
QueryBuilder with one extra `andWhere`.

## See also

- [`accessibleBy()` in detail](/docs/core-concepts/forward-vs-reverse/)
- [Postgres RLS](/docs/integration/rls-postgres/) — defense-in-depth at the DB layer.
- [Performance](/docs/advanced/performance/) — query plans, indexes, and scale.
