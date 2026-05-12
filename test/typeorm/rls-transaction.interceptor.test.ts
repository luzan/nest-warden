import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import { Logger, type CallHandler, type ExecutionContext } from '@nestjs/common';
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
  // The interceptor logs a one-time startup warning when instantiated.
  // Reset the class-level flag between tests so each test that cares
  // can assert from a clean slate. We also stub Logger.prototype.warn
  // so the noise doesn't leak into test output and so we can assert
  // on call counts where the test needs to.
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (
      RlsTransactionInterceptor as unknown as { startupWarningEmitted: boolean }
    ).startupWarningEmitted = false;
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

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

  describe('startup warning (Theme 9D demotion)', () => {
    it('emits a one-time warning when the interceptor is first instantiated', () => {
      const qr = buildMockQueryRunner();
      const ds = buildMockDataSource(qr);
      const tenantContext = new TenantContextService<string>();

      new RlsTransactionInterceptor(ds, tenantContext);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0]?.[0] as string;
      expect(message).toMatch(/RlsTransactionInterceptor/);
      expect(message).toMatch(/Auto-setting the RLS session variable/);
    });

    it('does not re-emit on subsequent constructions in the same module load', () => {
      // The flag persists across instances. Per-request scope is what
      // we're protecting against — without the static flag, every
      // request would log on cold-start instances. With it, only the
      // first construction in the module's lifetime logs.
      const qr = buildMockQueryRunner();
      const ds = buildMockDataSource(qr);
      const tenantContext = new TenantContextService<string>();

      new RlsTransactionInterceptor(ds, tenantContext);
      new RlsTransactionInterceptor(ds, tenantContext);
      new RlsTransactionInterceptor(ds, tenantContext);

      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('suppresses the warning when silentStartupWarning is true', () => {
      const qr = buildMockQueryRunner();
      const ds = buildMockDataSource(qr);
      const tenantContext = new TenantContextService<string>();

      new RlsTransactionInterceptor(ds, tenantContext, { silentStartupWarning: true });

      expect(warnSpy).not.toHaveBeenCalled();
      // And the flag stays `false` so a subsequent unsilenced
      // instance still logs on its first construction.
      expect(
        (RlsTransactionInterceptor as unknown as { startupWarningEmitted: boolean })
          .startupWarningEmitted,
      ).toBe(false);
    });
  });
});
