import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from '../user/admin-user.entity';
import { AdminAuthService } from '@/modules/admin/identity/auth/application/admin-auth.service';
import { AdminPasswordHashService } from '@/modules/admin/identity/auth/application/admin-password-hash.service';
import { AdminRefreshTokenStateStore } from '@/modules/admin/identity/auth/infrastructure/persistence/admin-refresh-token-state.store';
import { AdminSuperGuard } from '@/modules/admin/identity/auth/presentation/admin-super.guard';
import { AdminTokenService } from '@/modules/admin/identity/auth/application/admin-token.service';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([AdminUser])],
  providers: [
    AdminAuthService,
    AdminPasswordHashService,
    AdminRefreshTokenStateStore,
    AdminSuperGuard,
    AdminTokenService,
    JwtAuthGuard,
  ],
  exports: [
    AdminAuthService,
    AdminPasswordHashService,
    AdminSuperGuard,
    AdminTokenService,
    JwtAuthGuard,
  ],
})
export class AdminAuthGuardModule {}
