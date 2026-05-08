---
title: Installation
---

## Prerequisites

- **Node.js** 18.18+ (lib targets 18 / 20 / 22)
- **TypeScript** 5.0+ recommended
- **Postgres** 14+ (for production with RLS) — `better-sqlite3` works
  for tests if you don't need the RLS layer
- **NestJS** 10 or 11 (only required for the `nest-warden/nestjs` module)
- **TypeORM** 0.3 (only required for the `nest-warden/typeorm` module)

## Install

{% tabs %}
{% tab label="pnpm" %}
```bash
pnpm add nest-warden @casl/ability
```
{% /tab %}
{% tab label="npm" %}
```bash
npm install nest-warden @casl/ability
```
{% /tab %}
{% tab label="yarn" %}
```bash
yarn add nest-warden @casl/ability
```
{% /tab %}
{% /tabs %}

The `@casl/ability` peer dependency is **always required** — nest-warden
builds on CASL's rule index and `mongoQueryMatcher`.

## Adapters

The NestJS and TypeORM modules are optional peers — only install the
ones you need.

{% tabs %}
{% tab label="NestJS + TypeORM (typical)" %}
```bash
pnpm add nest-warden @casl/ability \
  @nestjs/common @nestjs/core typeorm pg \
  reflect-metadata rxjs
```
{% /tab %}
{% tab label="Core only (browser / shared lib)" %}
```bash
pnpm add nest-warden @casl/ability
```
The core import has zero NestJS / TypeORM dependencies and is safe to
bundle for the browser.
{% /tab %}
{% tab label="TypeORM only (no NestJS)" %}
```bash
pnpm add nest-warden @casl/ability typeorm pg
```
Use the `nest-warden/typeorm` import directly without registering the
NestJS module.
{% /tab %}
{% /tabs %}

## TypeScript configuration

The library is published as ESM with CommonJS fallback. For consumers
using TypeScript:

- `"moduleResolution": "Bundler"` (TypeScript 5.0+) or
  `"moduleResolution": "NodeNext"` for the resolver to find the
  subpath exports (`nest-warden/nestjs`, `nest-warden/typeorm`).
- `"target": "ES2022"` or higher.
- `"experimentalDecorators": true` and `"emitDecoratorMetadata": true`
  if you're using NestJS or TypeORM with the included decorators.

{% callout type="warning" title="esbuild + decorator metadata" %}
Tools that compile TypeScript via esbuild (tsup, tsx, Vitest's default
transformer) **do not implement** TypeScript's
`emitDecoratorMetadata` transform. NestJS's auto-DI relies on that
metadata; without it, class-typed constructor parameters resolve to
`undefined` and your guards / services crash at runtime.

nest-warden uses explicit `@Inject(...)` everywhere internally, so the
library itself works under all bundlers. **Your app code should do the
same** — see [FINDINGS § 3](/docs/integration/nestjs/#esbuild-and-decorators)
on the example app.
{% /callout %}

## Verify the install

Quick smoke test:

```ts
import { TenantAbilityBuilder, createMongoAbility } from 'nest-warden';

const builder = new TenantAbilityBuilder(createMongoAbility, {
  tenantId: 'demo',
  subjectId: 'me',
  roles: ['admin'],
});
builder.can('read', 'Merchant');
const ability = builder.build();
console.log(ability.can('read', { __caslSubjectType__: 'Merchant', tenantId: 'demo' }));
// → true
```

If that prints `true`, the install is correct.

## Next steps

- [Tenant Context](/docs/core-concepts/tenant-context/)
- [Tenant-aware Builder](/docs/core-concepts/tenant-builder/)
- [NestJS module setup](/docs/integration/nestjs/)
