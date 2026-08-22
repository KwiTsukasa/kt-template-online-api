import { Module } from '@nestjs/common';
import { BotAdapterRegistry } from './registry/bot-adapter.registry';

@Module({
  exports: [BotAdapterRegistry],
  providers: [BotAdapterRegistry],
})
export class BotProtocolModule {}
