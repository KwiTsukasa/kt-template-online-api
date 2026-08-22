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
import { QqbotAccountMessagePushService } from './qqbot-account-message-push.service';
import { QqbotMessageTargetOptionsService } from './qqbot-message-target-options.service';
import {
  AccountMessagePushBindingParamDto,
  AccountMessagePushParamDto,
  MessagePublishBindingInputDto,
} from './qqbot-message-subscriber.dto';
import { MessageEnabledDto } from '@/modules/message-management/contract/message-management.dto';
import { MessageManagementPermission } from '@/modules/message-management/contract/message-management-permission.decorator';
import { MessageManagementContractErrorInterceptor } from '@/modules/message-management/contract/message-management-contract-error.interceptor';
import { MessageManagementPermissionGuard } from '@/modules/message-management/contract/message-management-permission.guard';
import { SystemMessageContractError } from '@/modules/message-management/contract/message-management.types';
import type {
  QqbotMessagePublishBindingView,
  QqbotMessagePushTargetOptionsResponse,
} from './qqbot-message-subscriber.types';

const allowlistBinding = (
  view: QqbotMessagePublishBindingView,
): QqbotMessagePublishBindingView => ({
  available: view.available,
  createTime: view.createTime,
  enabled: view.enabled,
  id: view.id,
  invalidReasonCode: view.invalidReasonCode,
  sourceKey: view.sourceKey,
  sourceName: view.sourceName,
  subscriptionId: view.subscriptionId,
  subscriptionName: view.subscriptionName,
  targets: view.targets.map((target) => ({
    enabled: target.enabled,
    id: target.id,
    targetId: target.targetId,
    targetName: target.targetName,
    targetType: target.targetType,
  })),
  templates: view.templates.map((template) => ({ ...template })),
  updateTime: view.updateTime,
});

const allowlistTargetOptions = (
  value: QqbotMessagePushTargetOptionsResponse,
): QqbotMessagePushTargetOptionsResponse => ({
  available: value.available,
  connectionMode: value.connectionMode,
  manualEntry: value.manualEntry,
  options: value.options.map((option) => ({
    label: option.label,
    targetId: option.targetId,
    targetType: option.targetType,
  })),
  reasonCode: value.reasonCode,
});

@Controller([
  'message-management/subscribers/qqbot/accounts/:selfId',
  'qqbot/accounts/:selfId/message-push',
])
@UseGuards(JwtAuthGuard, MessageManagementPermissionGuard)
@UseInterceptors(MessageManagementContractErrorInterceptor)
@UsePipes(
  new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class QqbotAccountMessagePushController {
  constructor(
    private readonly bindingService: QqbotAccountMessagePushService,
    private readonly targetOptionsService: QqbotMessageTargetOptionsService,
  ) {}

  /**
   * 按`params`读取绑定；从 `bindingService.listBindings` 读取绑定。
   * @param params - 用于绑定的领域对象，包含 `selfId` 字段。
   * @returns 返回账号当前消息推送绑定视图列表或对应成功响应。
   */
  @Get('bindings')
  @MessageManagementPermission(
    'MessageManagement:Push:List',
    'QqBot:Account:MessagePush:List',
  )
  async listBindings(@Param() params: AccountMessagePushParamDto) {
    const views = await this.bindingService.listBindings(params.selfId);
    return vbenSuccess(views.map(allowlistBinding));
  }

  /**
   * 为指定账号创建消息推送绑定，并返回包含来源与模板信息的绑定视图。
   * @param params - 用于绑定的领域对象，包含 `selfId` 字段。
   * @param body - 用于绑定的结构化输入。
   * @returns 返回新建的消息推送绑定视图或对应成功响应。
   */
  @Post('bindings')
  @HttpCode(HttpStatus.OK)
  @MessageManagementPermission(
    'MessageManagement:Push:Create',
    'QqBot:Account:MessagePush:Create',
  )
  async createBinding(
    @Param() params: AccountMessagePushParamDto,
    @Body() body: MessagePublishBindingInputDto,
  ) {
    this.assertTargetIds(params.selfId, body);
    return vbenSuccess(
      allowlistBinding(
        await this.bindingService.createBinding(params.selfId, body),
      ),
    );
  }

  /**
   * 按账号和绑定标识更新消息推送配置，并返回更新后的绑定视图。
   * @param params - 用于绑定的领域对象，包含 `selfId`、`id` 字段。
   * @param body - 用于绑定的结构化输入。
   * @returns 返回更新后的消息推送绑定视图或对应成功响应。
   */
  @Put('bindings/:id')
  @MessageManagementPermission(
    'MessageManagement:Push:Update',
    'QqBot:Account:MessagePush:Update',
  )
  async updateBinding(
    @Param() params: AccountMessagePushBindingParamDto,
    @Body() body: MessagePublishBindingInputDto,
  ) {
    this.assertTargetIds(params.selfId, body);
    return vbenSuccess(
      allowlistBinding(
        await this.bindingService.updateBinding(params.selfId, params.id, body),
      ),
    );
  }

  /**
   * 将输入收敛并投影为切换绑定。
   * @param params - 用于切换绑定的领域对象，包含 `selfId`、`id` 字段。
   * @param body - 用于切换绑定的结构化输入，包含 `enabled` 字段。
   * @returns 切换绑定。
   */
  @Put('bindings/:id/enabled')
  @MessageManagementPermission(
    'MessageManagement:Push:Toggle',
    'QqBot:Account:MessagePush:Toggle',
  )
  async toggleBinding(
    @Param() params: AccountMessagePushBindingParamDto,
    @Body() body: MessageEnabledDto,
  ) {
    return vbenSuccess(
      allowlistBinding(
        await this.bindingService.setBindingEnabled(
          params.selfId,
          params.id,
          body.enabled,
        ),
      ),
    );
  }

  /**
   * 按账号和绑定标识删除消息推送绑定，并封装删除后的成功响应。
   * @param params - 用于绑定的领域对象，包含 `selfId`、`id` 字段。
   * @returns 返回删除绑定后的成功响应。
   */
  @Delete('bindings/:id')
  @MessageManagementPermission(
    'MessageManagement:Push:Delete',
    'QqBot:Account:MessagePush:Delete',
  )
  async removeBinding(@Param() params: AccountMessagePushBindingParamDto) {
    return vbenSuccess(
      await this.bindingService.removeBinding(params.selfId, params.id),
    );
  }

  /**
   * 按`params`读取目标；从 `targetOptionsService.listTargetOptions` 读取目标。
   * @param params - 用于目标的领域对象，包含 `selfId` 字段。
   * @returns 目标。
   */
  @Get('targets')
  @MessageManagementPermission(
    'MessageManagement:Push:Create',
    'MessageManagement:Push:Update',
    'QqBot:Account:MessagePush:Create',
    'QqBot:Account:MessagePush:Update',
  )
  async listTargets(@Param() params: AccountMessagePushParamDto) {
    return vbenSuccess(
      allowlistTargetOptions(
        await this.targetOptionsService.listTargetOptions(params.selfId),
      ),
    );
  }

  /**
   * 按路由账号类型校验嵌套目标，NapCat 拒绝短数字，官方账号保留 OpenID 字符串合同。
   * @param selfId - 已通过参数 DTO 校验的 NapCat 或官方稳定账号键。
   * @param body - 包含待保存群聊和私聊目标的绑定请求。
   * @throws 任一目标不符合当前 transport 的 ID 格式时抛出稳定契约错误。
   */
  private assertTargetIds(
    selfId: string,
    body: MessagePublishBindingInputDto,
  ): void {
    let pattern = /^[1-9]\d{4,19}$/u;
    if (selfId.startsWith('qq-official:')) {
      pattern = /^[A-Za-z0-9_-]{1,64}$/u;
    }
    const invalid = body.targets.some(
      (target) => !pattern.test(target.targetId),
    );
    if (invalid) throw new SystemMessageContractError('invalid_target_id');
  }
}
