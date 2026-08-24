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
  MediaGovernanceCatalogIdentitySearchQueryDto,
  MediaGovernanceMagnetBatchCreateDto,
  MediaGovernanceRssDiscoverySearchDto,
  MediaGovernanceRssIdentitySearchQueryDto,
  MediaGovernanceRssSubscriptionCreateDto,
  MediaGovernanceRssSubscriptionRebindDto,
  MediaGovernanceRssSubscriptionStateDto,
  MediaGovernanceSeriesPageQueryDto,
  MediaGovernanceSeriesCreateDto,
  MediaGovernanceSeriesSeasonFactDto,
  MediaGovernanceWorkCreateDto,
  MediaGovernanceWorkTaskCreateDto,
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
   * 返回 Series/Work 创建使用的通用身份候选并禁止缓存。
   *
   * @param query - 作品关键词与目标 Work 类型。
   * @param response - 当前 HTTP 响应。
   * @returns Bangumi/TMDB 候选和来源状态。
   */
  @Get('identity-candidates')
  @ApiOperation({ summary: '搜索 Series/Work 主身份候选' })
  async identityCandidates(
    @Query() query: MediaGovernanceCatalogIdentitySearchQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.catalog.identityCandidates(query));
  }

  /**
   * 把用户选中的官方身份交给服务层二次核验，并返回同一事务生成的 Series 与主 Work。
   *
   * @param body - 主 Work 类型与资料身份。
   * @param response - 当前 HTTP 响应。
   * @returns 新 Series 完整详情。
   */
  @Post()
  @MediaGovernancePermission('Media:Governance:Create')
  @ApiOperation({ summary: '创建 Series 与主 Work' })
  async createSeries(
    @Body() body: MediaGovernanceSeriesCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.catalog.createSeries(body));
  }

  /**
   * 在路径指定 Series 的所有权门内重新核验身份，并附加不会伪造 Season 的独立 Work。
   *
   * @param seriesId - 目标 Series 标识。
   * @param body - Work 类型与资料身份。
   * @param response - 当前 HTTP 响应。
   * @returns 更新后的 Series 详情。
   */
  @Post(':seriesId/works')
  @MediaGovernancePermission('Media:Governance:Create')
  @ApiOperation({ summary: '向 Series 添加 Work' })
  async createWork(
    @Param('seriesId') seriesId: string,
    @Body() body: MediaGovernanceWorkCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.catalog.createWork(seriesId, body));
  }

  /**
   * 校验路径中的 Series/Work 归属与 TV 类型后，创建一个连续且无重复季号的 Season/Episode 区间。
   *
   * @param seriesId - Work 所属 Series 标识。
   * @param workId - 目标 Work 标识。
   * @param body - 季号、标题和连续集范围。
   * @param response - 当前 HTTP 响应。
   * @returns 更新后的 Series 详情。
   */
  @Post(':seriesId/works/:workId/seasons')
  @MediaGovernancePermission('Media:Governance:Create')
  @ApiOperation({ summary: '为 TV Work 创建 Season' })
  async createSeason(
    @Param('seriesId') seriesId: string,
    @Param('workId') workId: string,
    @Body() body: MediaGovernanceSeriesSeasonFactDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.catalog.createSeason(seriesId, workId, body));
  }

  /**
   * 从既有 Work 派生身份快照并创建一次 source-intake 执行 Task。
   *
   * @param seriesId - Task 所属 Series 标识。
   * @param workId - Task 所属 Work 标识。
   * @param body - TV Work 的已有季号选择。
   * @param response - 当前 HTTP 响应。
   * @returns 新建执行 Task。
   */
  @Post(':seriesId/works/:workId/tasks')
  @MediaGovernancePermission('Media:Governance:Create')
  @ApiOperation({ summary: '从 Work 创建执行 Task' })
  async createWorkTask(
    @Param('seriesId') seriesId: string,
    @Param('workId') workId: string,
    @Body() body: MediaGovernanceWorkTaskCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.catalog.createWorkTask(seriesId, workId, body),
    );
  }

  /**
   * 返回全部历史任务的系列归类状态、确定性原因和可复用 reconcile 目标。
   * @param response - 当前 HTTP 响应。
   * @returns 历史任务分类报告。
   */
  @Get('history-classification')
  @ApiOperation({ summary: '核对历史媒体任务的系列归类状态' })
  async historyClassification(@Res({ passthrough: true }) response: Response) {
    this.noStore(response);
    return vbenSuccess(await this.catalog.historyClassification());
  }

  /**
   * 按搜索框文本并行返回 Bangumi 与 TMDB 的 TV 身份候选。
   *
   * @param query - 用户输入的作品名称或别名。
   * @param response - 当前 HTTP 响应。
   * @returns 身份候选及资料源独立状态。
   */
  @Get('rss-discovery/identity-candidates')
  @ApiOperation({ summary: '搜索 RSS 聚合所需资料身份候选' })
  async rssIdentityCandidates(
    @Query() query: MediaGovernanceRssIdentitySearchQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.catalog.rssIdentityCandidates(query));
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
   * @param workId - canonical Work 标识。
   * @param seasonNumber - canonical 季号。
   * @param query - 集分页参数。
   * @param response - 当前 HTTP 响应。
   * @returns 集分页。
   */
  @Get(':seriesId/works/:workId/seasons/:seasonNumber/episodes')
  @ApiOperation({ summary: '分页查询 canonical Episode' })
  async episodes(
    @Param('seriesId') seriesId: string,
    @Param('workId') workId: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Query() query: MediaGovernanceEpisodePageQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const result = await this.catalog.episodePage(
      seriesId,
      workId,
      seasonNumber,
      query,
    );
    return vbenPage(result.items, result.total);
  }

  /**
   * 把路由季号与最多十六条逐集磁链交给目录服务原子建立 Task-Episode 绑定。
   * @param seriesId - canonical Series 标识。
   * @param workId - canonical Work 标识。
   * @param seasonNumber - canonical 季号。
   * @param body - 统一分类和最多十六条按集磁链。
   * @param response - 当前 HTTP 响应。
   * @returns 新建 Task、来源和集绑定。
   */
  @Post(':seriesId/works/:workId/seasons/:seasonNumber/magnet-batch')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '按集批量创建多磁链媒体 Task' })
  async createMagnetBatch(
    @Param('seriesId') seriesId: string,
    @Param('workId') workId: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Body() body: MediaGovernanceMagnetBatchCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.catalog.createMagnetBatch(
        seriesId,
        workId,
        seasonNumber,
        body,
      ),
    );
  }

  /**
   * 在用户选择身份后查询固定活跃来源，并按 BTIH 和发布组聚合结果。
   *
   * @param seriesId - canonical Series 标识。
   * @param workId - canonical Work 标识。
   * @param seasonNumber - canonical Season 号。
   * @param body - 用户选择的资料身份。
   * @param response - 当前 HTTP 响应。
   * @returns 逐源状态、发布组和可订阅 RSS 入口。
   */
  @Post(':seriesId/works/:workId/seasons/:seasonNumber/rss-discovery/search')
  @ApiOperation({ summary: '按资料身份聚合 RSS 来源发布组' })
  async discoverRssSources(
    @Param('seriesId') seriesId: string,
    @Param('workId') workId: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Body() body: MediaGovernanceRssDiscoverySearchDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.catalog.discoverRssSources(
        seriesId,
        workId,
        seasonNumber,
        body,
      ),
    );
  }

  /**
   * 为一季创建 RSS 订阅并安排首次轮询。
   * @param seriesId - canonical Series 标识。
   * @param workId - canonical Work 标识。
   * @param seasonNumber - canonical 季号。
   * @param body - RSS 地址、过滤、集号正则和来源分类。
   * @param response - 当前 HTTP 响应。
   * @returns 新订阅。
   */
  @Post(':seriesId/works/:workId/seasons/:seasonNumber/rss-subscriptions')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '创建媒体季 RSS 订阅' })
  async createRssSubscription(
    @Param('seriesId') seriesId: string,
    @Param('workId') workId: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Body() body: MediaGovernanceRssSubscriptionCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.catalog.createRssSubscription(
        seriesId,
        workId,
        seasonNumber,
        body,
      ),
    );
  }

  /**
   * 在目标 Work/Season 已核验且旧入队 Task 已清理后，原子迁移订阅上下文并重置条目等待重入队。
   *
   * @param seriesId - 目标 Work 所属 Series。
   * @param workId - 订阅应归属的精确 Work。
   * @param seasonNumber - 订阅应归属的连续集范围。
   * @param subscriptionId - 需要纠正上下文的订阅。
   * @param body - 客户端读到的当前订阅 revision。
   * @param response - 当前 HTTP 响应。
   * @returns 已迁移到目标 Work/Season 的订阅。
   */
  @Put(
    ':seriesId/works/:workId/seasons/:seasonNumber/rss-subscriptions/:subscriptionId/context',
  )
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '纠正 RSS 订阅的 Work/Season 上下文' })
  async rebindRssSubscription(
    @Param('seriesId') seriesId: string,
    @Param('workId') workId: string,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
    @Param('subscriptionId') subscriptionId: string,
    @Body() body: MediaGovernanceRssSubscriptionRebindDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.catalog.rebindRssSubscription(
        seriesId,
        workId,
        seasonNumber,
        subscriptionId,
        body,
      ),
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
