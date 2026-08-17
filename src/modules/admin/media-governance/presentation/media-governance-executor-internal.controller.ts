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
} from '@/modules/admin/media-governance/contract/media-governance.dto';
import { MediaGovernanceExecutorInternalGuard } from './media-governance-executor-internal.guard';
import { MediaGovernanceService } from '@/modules/admin/media-governance/application/media-governance.service';

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

  /**
   * 返回执行器回调、描述符兑换和固定零写边界的健康状态。
   * @returns 包含 `callbackReady`、`descriptorGrantReady`、`status`、`writeBoundaries` 字段的器回调、描述符兑换和固定零写边界的健康状态。
   */
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

  /**
   * 接收执行器状态事件并交由治理服务顺序应用。
   * @param body - 用于接收执行器状态事件并交由治理服务顺序应用的结构化输入。
   * @returns 接收执行器状态事件并交由治理服务顺序应用。
   */
  @Post('events')
  event(@Body() body: MediaGovernanceExecutorEventDto) {
    return this.service.applyExecutorEvent(body);
  }

  /**
   * 兑换一次性描述符授权并以不可缓存二进制响应返回。
   * @param body - 用于兑换一次性描述符授权并以不可缓存二进制响应返回的结构化输入。
   * @param response - 包含 `set`、`status` 字段的上游服务响应。
   */
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

  /**
   * 兑换一次性治理计划授权并以不可缓存 JSON 响应返回。
   * @param body - 用于兑换一次性治理计划授权并以不可缓存 JSON 响应返回的结构化输入。
   * @param response - 包含 `set`、`status` 字段的上游服务响应。
   */
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
