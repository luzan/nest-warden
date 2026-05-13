import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MembershipService } from './membership.service.js';
import { TenantMembership } from './tenant-membership.entity.js';
import { User } from './user.entity.js';
import { resolveJwtSecret } from './tokens.js';

/**
 * Groups the JWT signing/verification setup with the
 * `MembershipService` and the two auth-tier entities. Imported once
 * from `app.module.ts`; everything else (`JwtAuthGuard`,
 * controllers) consumes the exported providers via DI.
 *
 * `JwtService` is exported so the dev-only token-mint endpoint (see
 * `app.module.ts`) and the E2E suite's `signTokenFor` helper can
 * sign tokens with the same secret the guard verifies against.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, TenantMembership]),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: resolveJwtSecret(),
        // Both sign and verify pin the algorithm explicitly. The
        // verify-side `algorithms` allow-list is the structural
        // defense against the `alg: "none"` and HS/RS confusion
        // attacks: a token whose header advertises any algorithm
        // outside this list is rejected before the secret is even
        // consulted, regardless of jsonwebtoken's evolving
        // defaults. See test/e2e/auth.e2e.test.ts § "adversarial
        // scenarios" for the failing-attack assertions.
        signOptions: { expiresIn: '15m', algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [MembershipService],
  exports: [MembershipService, JwtModule],
})
export class AuthModule {}
