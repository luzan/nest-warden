import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

/**
 * Mutable test-time DataSource configuration. Defaults point at the
 * docker-compose-managed Postgres on port 54329 — chosen high enough to
 * avoid conflicts with a developer's main Postgres on 5432 or a
 * secondary instance on 5433. Override via the DB_PORT env var (or
 * MTC_EXAMPLE_DB_PORT for docker-compose).
 *
 * E2E tests call {@link setExampleDataSourceConfig} after starting the
 * testcontainers Postgres (which always uses a free random port), so
 * the same `AppModule` works in both modes.
 */
type PgConn = Pick<
  PostgresConnectionOptions,
  'type' | 'host' | 'port' | 'username' | 'password' | 'database'
>;

let current: PgConn = {
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 54329),
  username: process.env.DB_USER ?? 'app_user',
  password: process.env.DB_PASSWORD ?? 'local_password',
  database: process.env.DB_NAME ?? 'nestwarden_dev',
};

export function getExampleDataSourceConfig(): PgConn {
  return current;
}

export function setExampleDataSourceConfig(config: PgConn): void {
  current = config;
}
