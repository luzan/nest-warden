import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';
import { RlsTransactionInterceptor } from '../../src/typeorm/rls-transaction.interceptor.js';
import { TenantContextService } from '../../src/nestjs/tenant-context.service.js';
import type { TenantContext } from '../../src/core/tenant-context.js';

const ctx: TenantContext<string> = { tenantId: 't1', subjectId: 'u1', roles: [] };

interface MockQueryRunner {
  connect: ReturnType<typeof vi.fn>;
  startTransaction: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  commitTransaction: ReturnType<typeof vi.fn>;
  rollbackTransaction: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

const buildMockQueryRunner = (): MockQueryRunner => ({
  connect: vi.fn().mockResolvedValue(undefined),
  startTransaction: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue(undefined),
  commitTransaction: vi.fn().mockResolvedValue(undefined),
  rollbackTransaction: vi.fn().mockResolvedValue(undefined),
  release: vi.fn().mockResolvedValue(undefined),
});

const buildMockDataSource = (qr: MockQueryRunner): DataSource =>
  ({
    createQueryRunner: () => qr as unknown as QueryRunner,
  }) as unknown as DataSource;

const fakeExecCtx = (): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  }) as unknown as ExecutionContext;

describe('RlsTransactionInterceptor', () => {
  it('skips the transaction when no tenant context is set', async () => {
    const qr = buildMockQueryRunner();
    const ds = buildMockDataSource(qr);
    const tenantContext = new TenantContextService<string>();
    const interceptor = new RlsTransactionInterceptor(ds, tenantContext);
    const next: CallHandler = { handle: () => of('result') };

    const obs = interceptor.intercept(fakeExecCtx(), next);
    expect(await firstValueFrom(obs)).toBe('result');
    expect(qr.connect).not.toHaveBeenCalled();
  });

  it('opens a transaction, sets the RLS variable, and commits on success', async () => {
    const qr = buildMockQueryRunner();
    const ds = buildMockDataSource(qr);
    const tenantContext = new TenantContextService<string>();
    tenantContext.set(ctx);
    const interceptor = new RlsTransactionInterceptor(ds, tenantContext);

    const next: CallHandler = { handle: () => of('result') };

    expect(await firstValueFrom(interceptor.intercept(fakeExecCtx(), next))).toBe('result');
    expect(qr.connect).toHaveBeenCalled();
    expect(qr.startTransaction).toHaveBeenCalled();
    expect(qr.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', [
      'app.current_tenant_id',
      't1',
    ]);
    expect(qr.commitTransaction).toHaveBeenCalled();
    expect(qr.rollbackTransaction).not.toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalled();
  });

  it('rolls back when the route handler errors', async () => {
    const qr = buildMockQueryRunner();
    const ds = buildMockDataSource(qr);
    const tenantContext = new TenantContextService<string>();
    tenantContext.set(ctx);
    const interceptor = new RlsTransactionInterceptor(ds, tenantContext);

    const next: CallHandler = { handle: () => throwError(() => new Error('boom')) };

    await expect(firstValueFrom(interceptor.intercept(fakeExecCtx(), next))).rejects.toThrow(
      'boom',
    );
    expect(qr.rollbackTransaction).toHaveBeenCalled();
    expect(qr.commitTransaction).not.toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalled();
  });

  it('honors a custom variableName from options', async () => {
    const qr = buildMockQueryRunner();
    const ds = buildMockDataSource(qr);
    const tenantContext = new TenantContextService<string>();
    tenantContext.set(ctx);
    const interceptor = new RlsTransactionInterceptor(ds, tenantContext, {
      variableName: 'custom.tenant',
    });
    const next: CallHandler = { handle: () => of('ok') };

    await firstValueFrom(interceptor.intercept(fakeExecCtx(), next));
    expect(qr.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', [
      'custom.tenant',
      't1',
    ]);
  });

  it('coerces non-Error throws to Error before rejecting', async () => {
    const qr = buildMockQueryRunner();
    const ds = buildMockDataSource(qr);
    const tenantContext = new TenantContextService<string>();
    tenantContext.set(ctx);
    const interceptor = new RlsTransactionInterceptor(ds, tenantContext);

    const next: CallHandler = { handle: () => throwError(() => 'string-error') };

    await expect(firstValueFrom(interceptor.intercept(fakeExecCtx(), next))).rejects.toThrow(
      'string-error',
    );
  });
});
