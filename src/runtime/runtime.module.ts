import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../common';
import { RuntimeConfigService } from './config/runtime-config.service';
import { RuntimeEvidenceService } from './evidence/runtime-evidence.service';
import { RuntimeHealthController } from './health/runtime-health.controller';
import { RuntimeHealthService } from './health/runtime-health.service';

@Module({
  imports: [ConfigModule, CommonModule],
  controllers: [RuntimeHealthController],
  providers: [
    RuntimeConfigService,
    RuntimeEvidenceService,
    RuntimeHealthService,
  ],
  exports: [RuntimeConfigService, RuntimeEvidenceService, RuntimeHealthService],
})
export class RuntimeModule {}
