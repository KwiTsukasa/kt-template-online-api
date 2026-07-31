import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from '../user/admin-user.entity';
import { AdminAuthService } from './admin-auth.service';
import { AdminPasswordHashService } from './admin-password-hash.service';
import { AdminRefreshTokenStateStore } from './admin-refresh-token-state.store';
import { AdminSuperGuard } from './admin-super.guard';
import { AdminTokenService } from './admin-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

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
