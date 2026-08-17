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
import { QqbotAccountMessagePushService } from '../../application/message-push/qqbot-account-message-push.service';
import { QqbotMessageTargetOptionsService } from '../../application/message-push/qqbot-message-target-options.service';
import {
  AccountMessagePushBindingParamDto,
  AccountMessagePushParamDto,
  MessagePublishBindingInputDto,
  MessagePushEnabledDto,
} from './qqbot-message-push.dto';
import { QqbotMessagePushPermission } from './qqbot-message-push-permission.decorator';
import { QqbotMessagePushContractErrorInterceptor } from './qqbot-message-push-contract-error.interceptor';
import { QqbotMessagePushPermissionGuard } from './qqbot-message-push-permission.guard';
import type {
  QqbotMessagePublishBindingView,
  QqbotMessagePushTargetOptionsResponse,
} from './qqbot-message-push.types';

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
  templateId: view.templateId,
  templateName: view.templateName,
  updateTime: view.updateTime,
});

const allowlistTargetOptions = (
  value: QqbotMessagePushTargetOptionsResponse,
): QqbotMessagePushTargetOptionsResponse => ({
  available: value.available,
  options: value.options.map((option) => ({
    label: option.label,
    targetId: option.targetId,
    targetType: option.targetType,
  })),
  reasonCode: value.reasonCode,
});

@Controller('qqbot/accounts/:selfId/message-push')
@UseGuards(JwtAuthGuard, QqbotMessagePushPermissionGuard)
@UseInterceptors(QqbotMessagePushContractErrorInterceptor)
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

  /** 列出绑定。 */
  @Get('bindings')
  @QqbotMessagePushPermission('QqBot:Account:MessagePush:List')
  async listBindings(@Param() params: AccountMessagePushParamDto) {
    const views = await this.bindingService.listBindings(params.selfId);
    return vbenSuccess(views.map(allowlistBinding));
  }

  /** 创建绑定。 */
  @Post('bindings')
  @HttpCode(HttpStatus.OK)
  @QqbotMessagePushPermission('QqBot:Account:MessagePush:Create')
  async createBinding(
    @Param() params: AccountMessagePushParamDto,
    @Body() body: MessagePublishBindingInputDto,
  ) {
    return vbenSuccess(
      allowlistBinding(
        await this.bindingService.createBinding(params.selfId, body),
      ),
    );
  }

  /** 更新绑定。 */
  @Put('bindings/:id')
  @QqbotMessagePushPermission('QqBot:Account:MessagePush:Update')
  async updateBinding(
    @Param() params: AccountMessagePushBindingParamDto,
    @Body() body: MessagePublishBindingInputDto,
  ) {
    return vbenSuccess(
      allowlistBinding(
        await this.bindingService.updateBinding(params.selfId, params.id, body),
      ),
    );
  }

  /** 返回切换绑定。 */
  @Put('bindings/:id/enabled')
  @QqbotMessagePushPermission('QqBot:Account:MessagePush:Toggle')
  async toggleBinding(
    @Param() params: AccountMessagePushBindingParamDto,
    @Body() body: MessagePushEnabledDto,
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

  /** 移除绑定。 */
  @Delete('bindings/:id')
  @QqbotMessagePushPermission('QqBot:Account:MessagePush:Delete')
  async removeBinding(@Param() params: AccountMessagePushBindingParamDto) {
    return vbenSuccess(
      await this.bindingService.removeBinding(params.selfId, params.id),
    );
  }

  /** 列出目标。 */
  @Get('targets')
  @QqbotMessagePushPermission(
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
}
