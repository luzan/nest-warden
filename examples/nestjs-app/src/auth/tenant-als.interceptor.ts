import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  Scope,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContextService } from 'nest-warden/nestjs';
import { tenantAls } from './tenant-als.js';

/**
 * Wraps the controller's execution in `tenantAls.run(...)` so
 * non-Nest-managed code — notably `TenantSubscriber` registered on
 * the TypeORM `DataSource` — can read the active tenant id from
 * inside synchronous TypeORM hooks.
 *
 * Ordering matters. This interceptor must run AFTER
 * `nest-warden/nestjs`'s `TenantContextInterceptor` (which populates
 * `TenantContextService`) but BEFORE any service code that issues
 * TypeORM writes. NestJS applies global interceptors in
 * registration order; nest-warden's interceptor comes from a
 * module import (loaded earlier in the dep graph) so it always
 * wraps outermost.
 *
 * The Observable wrapper preserves the controller's emission timing.
 * `tenantAls.run(store, fn)` invokes `fn` synchronously inside the
 * ALS scope; the inner subscription is created inside that scope,
 * so every TypeORM call the handler makes (including those
 * scheduled microtask-late) sees the store.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantAlsInterceptor implements NestInterceptor {
  constructor(@Inject(TenantContextService) private readonly ctx: TenantContextService) {}

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.ctx.has()) return next.handle();

    const tenantId = this.ctx.tenantId as string;
    return new Observable((subscriber) => {
      tenantAls.run({ tenantId }, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
