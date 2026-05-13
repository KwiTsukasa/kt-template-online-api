import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComponentController } from './component.controller';
import { ComponentService } from './component.service';
import { Component } from './component.entity';
import { ToolsService } from '@/common';
import { DictModule } from '@/dict/dict.module';

@Module({
  imports: [TypeOrmModule.forFeature([Component]), DictModule],
  controllers: [ComponentController],
  providers: [ComponentService, ToolsService],
  exports: [ComponentService],
})
export class ComponentModule {}
