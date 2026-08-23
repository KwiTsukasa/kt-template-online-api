import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { vbenPage, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import {
  MediaGovernanceEpisodePageQueryDto,
  MediaGovernanceMagnetBatchCreateDto,
  MediaGovernanceRssSubscriptionCreateDto,
  MediaGovernanceRssSubscriptionStateDto,
  MediaGovernanceSeriesPageQueryDto,
  MediaGovernanceSeriesReconcileDto,
} from '@/modules/admin/media-governance/contract/media-governance-catalog.dto';
import { MediaGovernanceCatalogService } from '@/modules/admin/media-governance/application/media-governance-catalog.service';
import {
  MediaGovernancePermission,
  MediaGovernancePermissionGuard,
} from './media-governance-permission.guard';

@ApiTags('Admin - 媒体系列治理')
@Controller('media-governance/series')
@UseGuards(JwtAuthGuard, MediaGovernancePermissionGuard)
@MediaGovernancePermission('Media:Governance:List')
@UsePipes(
  new ValidationPipe({
    exceptionFactory: () =>
      new HttpException(
        {
          err: '请求参数不符合媒体系列合同',
          msg: '请求参数校验失败',
        },
        HttpStatus.BAD_REQUEST,
      ),
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class MediaGovernanceCatalogController {
  constructor(private readonly catalog: MediaGovernanceCatalogService) {}

  /**
   * 分页返回 Series 卡片事实并禁止客户端缓存。
   * @param query - 页码、页大小和关键词。
   * @param response - 当前 HTTP 响应。
   * @returns 系列分页。
   */
  @Get('page')
  @ApiOperation({ summary: '分页查询 canonical 媒体系列' })
  async page(
    @Query() query: MediaGovernanceSeriesPageQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const result = await this.catalog.page(query);
    return vbenPage(result.items, result.total);
  }

  /**
   * 按唯一资料事实创建或纠正 Series/Season/Episode 与 Task 绑定。
   * @param body - canonical 系列事实和 Task 集范围。
   * @param response - 当前 HTTP 响应。
   * @returns 纠正后的系列详情。
   */
  @Post('reconcile')
  @MediaGovernancePermission('Media:Governance:Run')
  @ApiOperation({ summary: '按唯一事实纠正媒体系列层级' })
  async reconcile(
    @Body() body: MediaGovernanceSeriesReconcileDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.catalog.reconcile(body));
  }

  /**
   * 返回一个 Series 的季、资料引用、Task 覆盖与 RSS 订阅。
   * @param seriesId - canonical Series 标识。
   * @param response - 当前 HTTP 响应。
   * @returns 系列详情。
   */
  @Get(':seriesId')
  @ApiOperation({ summary: '查询 canonical 媒体系列详情' })
  async detail(
    @Param('seriesId') seriesId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.catalog.detail(seriesId));
  }

  /**
   * 分页返回一季 Episode 与 Task/来源绑定。
   * @param seriesId - canonical Series 标识。
   * @param seasonNumber - canonical 季号。
   * @param query - 集分页参数。
   * @param response - 当前 HTTP 响应。
   * @returns 集分页。
   */
  @Get(':seriesId/seasons/:seasonNumber/episodes')
  @ApiOperation({ summary: '分页查询 canonical Episode' })
  async episodes(
    @Param('seriesId') seriesId: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Query() query: MediaGovernanceEpisodePageQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const result = await this.catalog.episodePage(
      seriesId,
      seasonNumber,
      query,
    );
    return vbenPage(result.items, result.total);
  }

  /**
   * 把路由季号与最多十六条逐集磁链交给目录服务原子建立 Task-Episode 绑定。
   * @param seriesId - canonical Series 标识。
   * @param seasonNumber - canonical 季号。
   * @param body - 统一分类和最多十六条按集磁链。
   * @param response - 当前 HTTP 响应。
   * @returns 新建 Task、来源和集绑定。
   */
  @Post(':seriesId/seasons/:seasonNumber/magnet-batch')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '按集批量创建多磁链媒体 Task' })
  async createMagnetBatch(
    @Param('seriesId') seriesId: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Body() body: MediaGovernanceMagnetBatchCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.catalog.createMagnetBatch(seriesId, seasonNumber, body),
    );
  }

  /**
   * 为一季创建 RSS 订阅并安排首次轮询。
   * @param seriesId - canonical Series 标识。
   * @param seasonNumber - canonical 季号。
   * @param body - RSS 地址、过滤、集号正则和来源分类。
   * @param response - 当前 HTTP 响应。
   * @returns 新订阅。
   */
  @Post(':seriesId/seasons/:seasonNumber/rss-subscriptions')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '创建媒体季 RSS 订阅' })
  async createRssSubscription(
    @Param('seriesId') seriesId: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Body() body: MediaGovernanceRssSubscriptionCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.catalog.createRssSubscription(seriesId, seasonNumber, body),
    );
  }

  /**
   * 用客户端读到的 revision 拒绝过期启停，启用时安排立即轮询。
   * @param subscriptionId - RSS 订阅标识。
   * @param body - 期望 revision 和目标状态。
   * @param response - 当前 HTTP 响应。
   * @returns 更新后的订阅。
   */
  @Put('rss-subscriptions/:subscriptionId/state')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '启停媒体 RSS 订阅' })
  async setRssSubscriptionState(
    @Param('subscriptionId') subscriptionId: string,
    @Body() body: MediaGovernanceRssSubscriptionStateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.catalog.setRssSubscriptionState(subscriptionId, body),
    );
  }

  /**
   * 立即拉取并处理一个 RSS 订阅。
   * @param subscriptionId - RSS 订阅标识。
   * @param response - 当前 HTTP 响应。
   * @returns 本轮发现、忽略和入队数量。
   */
  @Post('rss-subscriptions/:subscriptionId/poll')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '立即轮询媒体 RSS 订阅' })
  async pollRssSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.catalog.pollRssSubscription(subscriptionId));
  }

  /**
   * 分页返回 RSS 条目的解析和 Task 入队历史。
   * @param subscriptionId - RSS 订阅标识。
   * @param query - 分页参数。
   * @param response - 当前 HTTP 响应。
   * @returns RSS 条目分页。
   */
  @Get('rss-subscriptions/:subscriptionId/items')
  @ApiOperation({ summary: '分页查询媒体 RSS 条目历史' })
  async rssItems(
    @Param('subscriptionId') subscriptionId: string,
    @Query() query: MediaGovernanceEpisodePageQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const result = await this.catalog.rssItemPage(subscriptionId, query);
    return vbenPage(result.items, result.total);
  }

  /**
   * 为每个动态目录响应写入 `no-store`，防止浏览器或反向代理复用旧层级。
   * @param response - 当前 HTTP 响应。
   */
  private noStore(response: Response) {
    response.setHeader('Cache-Control', 'no-store');
  }
}
