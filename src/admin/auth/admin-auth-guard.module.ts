import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from '../user/admin-user.entity';
import { AdminAuthService } from './admin-auth.service';
import { AdminPasswordCryptoService } from './admin-password-crypto.service';
import { AdminTokenService } from './admin-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([AdminUser])],
  providers: [
    AdminAuthService,
    AdminPasswordCryptoService,
    AdminTokenService,
    JwtAuthGuard,
  ],
  exports: [
    AdminAuthService,
    AdminPasswordCryptoService,
    AdminTokenService,
    JwtAuthGuard,
  ],
})
export class AdminAuthGuardModule {}
