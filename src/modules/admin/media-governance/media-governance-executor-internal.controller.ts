import type { Response } from 'express';
import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  MediaGovernanceDescriptorRedeemDto,
  MediaGovernanceExecutorEventDto,
  MediaGovernancePlanRedeemDto,
} from './media-governance.dto';
import { MediaGovernanceExecutorInternalGuard } from './media-governance-executor-internal.guard';
import { MediaGovernanceService } from './media-governance.service';

@Controller('internal/media-governance/executor')
@UseGuards(MediaGovernanceExecutorInternalGuard)
@UsePipes(
  new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class MediaGovernanceExecutorInternalController {
  constructor(private readonly service: MediaGovernanceService) {}

  @Get('health')
  health() {
    const callback = this.service.executionCallbackHealth();
    return {
      callbackReady: callback.status === 'ready',
      descriptorGrantReady: callback.persistenceMode === 'database',
      status: callback.status,
      writeBoundaries: {
        cloud: 0,
        formalMedia: 0,
        ui: 0,
      },
    };
  }

  @Post('events')
  event(@Body() body: MediaGovernanceExecutorEventDto) {
    return this.service.applyExecutorEvent(body);
  }

  @Post('descriptors/redeem')
  async redeem(
    @Body() body: MediaGovernanceDescriptorRedeemDto,
    @Res() response: Response,
  ) {
    const bytes = await this.service.redeemDescriptor(body);
    response.set({
      'Cache-Control': 'no-store',
      'Content-Length': String(bytes.length),
      'Content-Type': 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    response.status(200).send(bytes);
  }

  @Post('plans/redeem')
  async redeemPlan(
    @Body() body: MediaGovernancePlanRedeemDto,
    @Res() response: Response,
  ) {
    const plan = await this.service.redeemPlan(body);
    response.set({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    response.status(200).send(plan);
  }
}
