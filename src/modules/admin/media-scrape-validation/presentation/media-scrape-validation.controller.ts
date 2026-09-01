import type { Response } from 'express';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { vbenPage, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import {
  MediaGovernancePermission,
  MediaGovernancePermissionGuard,
} from '@/modules/admin/media-governance/presentation/media-governance-permission.guard';
import { MediaScrapeValidationService } from '../application/media-scrape-validation.service';
import {
  MediaScrapeValidationPageQueryDto,
  MediaScrapeValidationResultDto,
  MediaScrapeValidationRevisionDto,
} from '../contract/media-scrape-validation.dto';
import { MediaScrapeValidationInternalGuard } from './media-scrape-validation-internal.guard';

const SCRAPE_VALIDATION_PIPE = new ValidationPipe({
  exceptionFactory: () =>
    new HttpException(
      {
        err: '请求参数不符合 NAS 刮削校验合同',
        msg: '请求参数校验失败',
      },
      HttpStatus.BAD_REQUEST,
    ),
  forbidNonWhitelisted: true,
  transform: true,
  whitelist: true,
});

@ApiTags('Admin - NAS 刮削校验')
@Controller('media-scrape-validation')
@UseGuards(JwtAuthGuard, MediaGovernancePermissionGuard)
@MediaGovernancePermission('Media:Governance:List')
@UsePipes(SCRAPE_VALIDATION_PIPE)
export class MediaScrapeValidationController {
  constructor(private readonly service: MediaScrapeValidationService) {}

  /**
   * 分页返回独立 NAS 刮削校验记录。
   * @param query - 状态、关键词与分页条件。
   * @param response - 用于写入禁止缓存头的 HTTP 响应。
   * @returns 标准分页响应。
   */
  @Get('page')
  @ApiOperation({ summary: '分页查询 NAS 刮削校验记录' })
  async page(
    @Query() query: MediaScrapeValidationPageQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const page = await this.service.page(query);
    return vbenPage(page.items, page.total);
  }

  /**
   * 返回一条独立 NAS 刮削校验详情。
   * @param validationId - 刮削校验记录标识。
   * @param response - 用于写入禁止缓存头的 HTTP 响应。
   * @returns 标准成功响应。
   */
  @Get(':validationId')
  @ApiOperation({ summary: '查询 NAS 刮削校验详情' })
  async detail(
    @Param('validationId') validationId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.detail(validationId));
  }

  /**
   * 将指定记录重新排入 NAS 刮削校验队列。
   * @param validationId - 刮削校验记录标识。
   * @param body - 绑定调用方已读取修订号的重试命令。
   * @param response - 用于写入禁止缓存头的 HTTP 响应。
   * @returns 标准成功响应。
   */
  @Post(':validationId/recheck')
  @MediaGovernancePermission('Media:Governance:Run')
  @ApiOperation({ summary: '重新排队 NAS 刮削校验' })
  async recheck(
    @Param('validationId') validationId: string,
    @Body() body: MediaScrapeValidationRevisionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.requestRecheck(validationId, body));
  }

  /**
   * 禁止浏览器和中间代理缓存动态校验状态。
   * @param response - 当前 HTTP 响应。
   */
  private noStore(response: Response) {
    response.setHeader('Cache-Control', 'no-store');
  }
}

@ApiTags('Internal - NAS 刮削校验')
@Controller('internal/media-scrape-validation')
@UseGuards(MediaScrapeValidationInternalGuard)
@UsePipes(SCRAPE_VALIDATION_PIPE)
export class MediaScrapeValidationInternalController {
  constructor(private readonly service: MediaScrapeValidationService) {}

  /**
   * 返回独立刮削校验队列的内部接口健康状态。
   * @returns 声明该模块不参与治理 Task 关闭门禁的健康投影。
   */
  @Get('health')
  health() {
    return {
      blocksMediaGovernance: false,
      status: 'ready',
    };
  }

  /**
   * 领取最早一条待处理 NAS 刮削校验记录。
   * @returns 已转为运行态的记录；队列为空时数据为 `null`。
   */
  @Post('claims/next')
  async claimNext() {
    return vbenSuccess(await this.service.claimNext());
  }

  /**
   * 提交一条 NAS 刮削校验结论且不触碰治理 Task。
   * @param validationId - 刮削校验记录标识。
   * @param body - 绑定运行修订号、证据摘要与缺项的结果。
   * @returns 已完成的独立校验投影。
   */
  @Post(':validationId/results')
  async complete(
    @Param('validationId') validationId: string,
    @Body() body: MediaScrapeValidationResultDto,
  ) {
    return vbenSuccess(await this.service.complete(validationId, body));
  }
}
