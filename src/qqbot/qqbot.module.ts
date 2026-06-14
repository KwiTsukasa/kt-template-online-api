import { Module } from '@nestjs/common';
import { QqbotCoreModule } from '@/modules/qqbot/core/qqbot-core.module';

@Module({
  imports: [QqbotCoreModule],
  exports: [QqbotCoreModule],
})
export class QqbotModule {}
