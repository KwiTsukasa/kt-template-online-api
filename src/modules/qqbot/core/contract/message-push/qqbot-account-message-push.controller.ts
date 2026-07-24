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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
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

/**
 * Narrows one account binding to the public management view and target fields.
 * @param view - Detached account binding service result.
 * @returns Only the locked binding and nested target response fields.
 */
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

/**
 * Narrows OneBot candidates to stable labels and string identifiers only.
 * @param value - Safe target-option service result.
 * @returns Detached availability result without runtime/provider objects.
 */
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
  /**
   * Initializes strict account-scoped binding and target management routes.
   * @param bindingService - Account binding lifecycle service.
   * @param targetOptionsService - HTTP-safe OneBot candidate service.
   */
  constructor(
    private readonly bindingService: QqbotAccountMessagePushService,
    private readonly targetOptionsService: QqbotMessageTargetOptionsService,
  ) {}

  /**
   * Lists binding views for exactly one account.
   * @param params - Validated QQ account route identity.
   */
  @Get('bindings')
  @QqbotMessagePushPermission('QqBot:Account:MessagePush:List')
  async listBindings(@Param() params: AccountMessagePushParamDto) {
    const views = await this.bindingService.listBindings(params.selfId);
    return vbenSuccess(views.map(allowlistBinding));
  }

  /**
   * Creates one binding for exactly one account.
   * @param params - Validated QQ account route identity.
   * @param body - Strict subscription, template, target, and enabled input.
   */
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

  /**
   * Replaces one binding for exactly one account.
   * @param params - Validated QQ account and binding route identities.
   * @param body - Strict subscription, template, target, and enabled input.
   */
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

  /**
   * Toggles one binding for exactly one account.
   * @param params - Validated QQ account and binding route identities.
   * @param body - Required JSON boolean state.
   */
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

  /**
   * Soft-deletes one binding for exactly one account.
   * @param params - Validated QQ account and binding route identities.
   */
  @Delete('bindings/:id')
  @QqbotMessagePushPermission('QqBot:Account:MessagePush:Delete')
  async removeBinding(@Param() params: AccountMessagePushBindingParamDto) {
    return vbenSuccess(
      await this.bindingService.removeBinding(params.selfId, params.id),
    );
  }

  /**
   * Lists HTTP-safe group and friend candidates for exactly one account.
   * @param params - Validated QQ account route identity.
   */
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
