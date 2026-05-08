import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from 'nest-warden/nestjs';

/**
 * Fake authentication for the example app. Reads `x-fake-user` header,
 * which carries a JSON `{ userId, tenantId, roles }` payload, and
 * attaches it to `request.user`.
 *
 * Production code should replace this with a real `JwtAuthGuard` (Passport
 * JWT or similar). The shape of `request.user` (string IDs and a `roles`
 * array) is deliberately compatible with what a JWT-claim-based guard
 * would produce.
 */
export interface FakeUser {
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
}

@Injectable()
export class FakeAuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(executionContext: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = executionContext
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined>; user?: FakeUser }>();
    const header = request.headers['x-fake-user'];
    if (typeof header !== 'string') {
      throw new UnauthorizedException('Missing x-fake-user header (example app fake auth).');
    }
    try {
      const parsed = JSON.parse(header) as FakeUser;
      if (!parsed.userId || !parsed.tenantId || !Array.isArray(parsed.roles)) {
        throw new Error('malformed');
      }
      request.user = parsed;
      return true;
    } catch {
      throw new UnauthorizedException('Malformed x-fake-user header.');
    }
  }
}
