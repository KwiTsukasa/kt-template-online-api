import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { MessageManagementContractErrorInterceptor } from '@/modules/message-management/contract/message-management-contract-error.interceptor';
import { MessageEnabledDto } from '@/modules/message-management/contract/message-management.dto';
import { MessageManagementPermission } from '@/modules/message-management/contract/message-management-permission.decorator';
import { MessageManagementPermissionGuard } from '@/modules/message-management/contract/message-management-permission.guard';
import {
  StationNoticeMessageBindingInputDto,
  StationNoticeMessageBindingParamDto,
} from './station-notice-message-binding.dto';
import { StationNoticeMessageBindingService } from './station-notice-message-binding.service';

@Controller('message-management/subscribers/station-notice/bindings')
@UseGuards(JwtAuthGuard, MessageManagementPermissionGuard)
@UseInterceptors(MessageManagementContractErrorInterceptor)
@UsePipes(
  new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class StationNoticeMessageBindingController {
  constructor(
    private readonly bindingService: StationNoticeMessageBindingService,
  ) {}

  /**
   * 向站内信管理页返回未删除私有绑定及其通用订阅、模板和来源快照。
   * @returns 站内信订阅者绑定视图列表。
   */
  @Get()
  @MessageManagementPermission('MessageManagement:Push:List')
  async list() {
    return vbenSuccess(await this.bindingService.list());
  }

  /**
   * 把通用消息订阅与站内信标题、接收角色保存为订阅者私有投递配置。
   * @param body - 站内信标题、接收角色、通用订阅标识和启用状态。
   * @returns 新建后的站内信订阅者绑定视图。
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @MessageManagementPermission('MessageManagement:Push:Create')
  async create(@Body() body: StationNoticeMessageBindingInputDto) {
    return vbenSuccess(await this.bindingService.create(body));
  }

  /**
   * 在保持站内信单订阅唯一约束的前提下替换私有投递配置。
   * @param params - 包含待更新绑定标识的路径参数。
   * @param body - 新的站内信标题、接收角色、订阅标识和启用状态。
   * @returns 更新后的站内信订阅者绑定视图。
   */
  @Put(':id')
  @MessageManagementPermission('MessageManagement:Push:Update')
  async update(
    @Param() params: StationNoticeMessageBindingParamDto,
    @Body() body: StationNoticeMessageBindingInputDto,
  ) {
    return vbenSuccess(await this.bindingService.update(params.id, body));
  }

  /**
   * 通过协议可用性门禁启停后续站内信物化，既有站内信历史不受影响。
   * @param params - 包含待切换绑定标识的路径参数。
   * @param body - 包含目标启用状态的请求体。
   * @returns 状态切换后的站内信订阅者绑定视图。
   */
  @Put(':id/enabled')
  @MessageManagementPermission('MessageManagement:Push:Toggle')
  async setEnabled(
    @Param() params: StationNoticeMessageBindingParamDto,
    @Body() body: MessageEnabledDto,
  ) {
    return vbenSuccess(
      await this.bindingService.setEnabled(params.id, body.enabled),
    );
  }

  /**
   * 软删除指定站内信订阅者绑定，同时保留已经生成的站内信记录。
   * @param params - 包含待删除绑定标识的路径参数。
   * @returns 删除成功响应。
   */
  @Delete(':id')
  @MessageManagementPermission('MessageManagement:Push:Delete')
  async remove(@Param() params: StationNoticeMessageBindingParamDto) {
    return vbenSuccess(await this.bindingService.remove(params.id));
  }
}
