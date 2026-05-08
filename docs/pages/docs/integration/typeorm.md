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
