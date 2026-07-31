import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpCode,
  HttpStatus,
  Param,
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
import { AdminSuperGuard } from '@/modules/admin/identity/auth/admin-super.guard';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { NetworkEndpointHistoryQueryDto } from './network-management.dto';
import {
  NetworkPortForwardGroupChannelMutationDto,
  NetworkPortForwardGroupChannelParamsDto,
  NetworkPortForwardGroupCreateDto,
  NetworkPortForwardGroupListQueryDto,
  NetworkPortForwardGroupParamsDto,
  NetworkPortForwardGroupUpdateDto,
} from './network-port-forward-group.dto';
import { NetworkPortForwardGroupService } from './network-port-forward-group.service';

@ApiTags('Admin - 网络逻辑端口转发组')
@Controller('system/network/port-forward-group')
@UseGuards(JwtAuthGuard, AdminSuperGuard)
@UsePipes(
  new ValidationPipe({
    exceptionFactory: () =>
      new HttpException(
        {
          err: '请求参数不符合接口约束',
          msg: '请求参数校验失败',
        },
        HttpStatus.BAD_REQUEST,
      ),
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class NetworkPortForwardGroupController {
  constructor(private readonly service: NetworkPortForwardGroupService) {}

  @Get('list')
  @ApiOperation({ summary: '分页查询逻辑端口转发组' })
  async list(
    @Query() query: NetworkPortForwardGroupListQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const page = await this.service.list(query);
    return vbenPage(page.items, page.total);
  }

  @Post()
  @ApiOperation({ summary: '新增逻辑端口转发组' })
  async create(
    @Body() body: NetworkPortForwardGroupCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.create(body));
  }

  @Put(':groupId')
  @ApiOperation({ summary: '修改逻辑端口转发组' })
  async update(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Body() body: NetworkPortForwardGroupUpdateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.update(params.groupId, body));
  }

  @Delete(':groupId')
  @ApiOperation({ summary: '删除逻辑端口转发组' })
  async remove(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.remove(params.groupId));
  }

  @Post(':groupId/channels/:protocol/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重试协议通道同步' })
  async retry(
    @Param() params: NetworkPortForwardGroupChannelParamsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.retry(params.groupId, params.protocol),
    );
  }

  @Get(':groupId/channels/:protocol/endpoint-history')
  @ApiOperation({ summary: '查询协议通道公网端点历史' })
  async endpointHistory(
    @Param() params: NetworkPortForwardGroupChannelParamsDto,
    @Query() query: NetworkEndpointHistoryQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const page = await this.service.endpointHistory(
      params.groupId,
      params.protocol,
      query,
    );
    return vbenPage(page.items, page.total);
  }

  @Post(':groupId/channels/tcp/natmap/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用 TCP NATMap' })
  async enableNatmap(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Body() body: NetworkPortForwardGroupChannelMutationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.enableNatmap(
        params.groupId,
        body.expectedDesiredRevision,
      ),
    );
  }

  @Post(':groupId/channels/tcp/natmap/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停用 TCP NATMap' })
  async disableNatmap(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Body() body: NetworkPortForwardGroupChannelMutationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.disableNatmap(
        params.groupId,
        body.expectedDesiredRevision,
      ),
    );
  }

  @Post(':groupId/channels/udp/keeper/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用 UDP STUN Keeper' })
  async enableKeeper(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.enableKeeper(params.groupId));
  }

  @Post(':groupId/channels/udp/keeper/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停用 UDP STUN Keeper' })
  async disableKeeper(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.disableKeeper(params.groupId));
  }

  @Post(':groupId/channels/udp/keeper/probe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '立即刷新 UDP 公网端点' })
  async probe(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.probe(params.groupId));
  }

  private noStore(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
  }
}
