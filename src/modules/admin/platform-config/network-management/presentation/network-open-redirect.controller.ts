import {
  Controller,
  Get,
  Head,
  HttpStatus,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { NetworkOpenRedirectService } from '@/modules/admin/platform-config/network-management/application/network-open-redirect.service';

@ApiTags('Public - NATMap 启动入口')
@Controller({
  host: 'open.kwitsukasa.top',
  path: 'network/open-redirect',
})
@UseGuards(JwtAuthGuard)
export class NetworkOpenRedirectController {
  constructor(private readonly service: NetworkOpenRedirectService) {}

  /** 返回头部。 */
  @Head(':serviceKey')
  @ApiOperation({ summary: '解析 NATMap 直连入口元数据' })
  @Public()
  async head(
    @Param('serviceKey') serviceKey: string,
    @Res() response: Response,
  ) {
    await this.respond(serviceKey, response);
  }

  /** 读取网络打开重定向记录。 */
  @Get(':serviceKey')
  @ApiOperation({ summary: '跳转到当前 NATMap 直连入口' })
  @Public()
  async get(
    @Param('serviceKey') serviceKey: string,
    @Res() response: Response,
  ) {
    await this.respond(serviceKey, response);
  }

  /** 返回响应网络打开重定向记录。 */
  private async respond(serviceKey: string, response: Response) {
    this.setHeaders(response);
    const resolution = await this.service
      .resolve(serviceKey)
      .catch(() => ({ status: 'unavailable' as const }));
    if (resolution.status === 'found') {
      response.setHeader('X-KT-Endpoint-IPv4', resolution.endpointIpv4);
      response.setHeader(
        'X-KT-Endpoint-Generation',
        resolution.endpointGeneration,
      );
      response.setHeader(
        'X-KT-Endpoint-Valid-Until',
        resolution.endpointValidUntil,
      );
      response.setHeader('Location', resolution.location);
      response.status(HttpStatus.FOUND).end();
      return;
    }
    if (resolution.status === 'unavailable') {
      response.setHeader('Retry-After', '30');
      response.status(HttpStatus.SERVICE_UNAVAILABLE).end();
      return;
    }
    response.status(HttpStatus.NOT_FOUND).end();
  }

  /** 设置请求头。 */
  private setHeaders(response: Response) {
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
}
