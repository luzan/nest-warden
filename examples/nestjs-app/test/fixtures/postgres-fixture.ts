import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', '..', 'sql', 'init.sql');

/**
 * Spin up a Postgres 16 container, apply the example app's schema (with
 * the same RLS policies that ship in `sql/init.sql`), and return both the
 * container and a connected TypeORM DataSource ready for the test.
 *
 * Why testcontainers: the headline guarantee of this example is "RLS at
 * the database layer prevents cross-tenant leakage." Verifying that
 * requires a real Postgres — sqlite has no equivalent. testcontainers
 * keeps the dev loop hermetic (no shared dev DB to muck up) and the CI
 * pipeline self-contained.
 */
export async function startPostgresWithSchema(): Promise<{
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
}> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withUsername('test_user')
    .withPassword('test_password')
    .withDatabase('test_db')
    .start();

  const dataSource = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();

  // Apply the schema. Strip `-- line comments` first (they may contain `;`
  // characters inside English prose), then split on `;` and trim.
  const rawSql = readFileSync(SCHEMA_PATH, 'utf-8');
  const sqlNoComments = rawSql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  const statements = sqlNoComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await dataSource.query(statement);
  }

  return { container, dataSource };
}
