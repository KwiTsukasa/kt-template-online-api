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
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { vbenPage, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import { QqbotMessageSubscriptionService } from '../../application/message-push/qqbot-message-subscription.service';
import { QqbotMessageTemplateService } from '../../application/message-push/qqbot-message-template.service';
import { SystemMessageSourceRegistry } from '../../application/message-push/system-message-source.registry';
import type {
  MessageSubscriptionView,
  MessageTemplatePreview,
  MessageTemplateView,
  StunMappingPortChangedOptionsResponse,
  SystemMessageSourceDefinition,
} from './qqbot-message-push.types';
import {
  MessagePushEnabledDto,
  MessagePushIdParamDto,
  MessagePushSourceParamDto,
  MessageSubscriptionInputDto,
  MessageSubscriptionListQueryDto,
  MessageTemplateInputDto,
  MessageTemplateListQueryDto,
  MessageTemplatePreviewDto,
} from './qqbot-message-push.dto';
import { QqbotMessagePushPermission } from './qqbot-message-push-permission.decorator';
import { QqbotMessagePushContractErrorInterceptor } from './qqbot-message-push-contract-error.interceptor';
import { QqbotMessagePushPermissionGuard } from './qqbot-message-push-permission.guard';

const SOURCE_READ_PERMISSIONS = [
  'QqBot:MessageSubscription:List',
  'QqBot:MessageSubscription:Create',
  'QqBot:MessageSubscription:Update',
  'QqBot:MessageTemplate:List',
  'QqBot:MessageTemplate:Create',
  'QqBot:MessageTemplate:Update',
  'QqBot:MessageTemplate:Preview',
  'QqBot:Account:MessagePush:List',
  'QqBot:Account:MessagePush:Create',
  'QqBot:Account:MessagePush:Update',
] as const;

/**
 * Returns an allowlisted detached source definition without exposing its adapter.
 * @param definition - Registered source definition owned by an internal adapter.
 * @returns A cloned definition containing only the public management contract.
 */
const cloneSourceDefinition = (
  definition: SystemMessageSourceDefinition,
): SystemMessageSourceDefinition => ({
  description: definition.description,
  displayName: definition.displayName,
  sourceKey: definition.sourceKey,
  subscriptionFields: definition.subscriptionFields.map((field) => ({
    ...(field.dependsOn === undefined ? {} : { dependsOn: field.dependsOn }),
    key: field.key,
    label: field.label,
    optionCollection: field.optionCollection,
    required: field.required,
    type: field.type,
  })),
  variables: definition.variables.map((variable) => ({
    description: variable.description,
    example: variable.example,
    key: variable.key,
    label: variable.label,
    type: variable.type,
  })),
  version: definition.version,
});

/**
 * Narrows weakly typed adapter options to the locked STUN management response.
 * @param value - Source adapter result after its domain-side eligibility checks.
 * @returns Detached port-forward and DDNS option rows with public fields only.
 */
const allowlistStunOptions = (
  value: Record<string, unknown>,
): StunMappingPortChangedOptionsResponse => {
  const input = value as unknown as StunMappingPortChangedOptionsResponse;
  return {
    ddnsRecords: input.ddnsRecords.map((item) => ({
      disabledReasonCode: item.disabledReasonCode,
      eligible: item.eligible,
      fqdn: item.fqdn,
      id: item.id,
      name: item.name,
      portForwardId: item.portForwardId,
    })),
    portForwards: input.portForwards.map((item) => ({
      disabledReasonCode: item.disabledReasonCode,
      eligible: item.eligible,
      externalPort: item.externalPort,
      id: item.id,
      internalPort: item.internalPort,
      name: item.name,
      protocol: item.protocol,
    })),
  };
};

/**
 * Narrows one subscription result to the public management view.
 * @param view - Detached service result that may evolve independently of HTTP.
 * @returns Only the locked subscription response fields and STUN config keys.
 */
const allowlistSubscription = (
  view: MessageSubscriptionView,
): MessageSubscriptionView => ({
  createTime: view.createTime,
  enabled: view.enabled,
  id: view.id,
  invalidReasonCode: view.invalidReasonCode,
  name: view.name,
  remark: view.remark,
  sourceConfig: {
    ddnsRecordId: view.sourceConfig.ddnsRecordId,
    portForwardId: view.sourceConfig.portForwardId,
  },
  sourceKey: view.sourceKey,
  sourceName: view.sourceName,
  sourceSummary: view.sourceSummary,
  updateTime: view.updateTime,
  valid: view.valid,
});

/**
 * Narrows one template result to the public management view.
 * @param view - Detached service result that may evolve independently of HTTP.
 * @returns Only the locked template response fields.
 */
const allowlistTemplate = (view: MessageTemplateView): MessageTemplateView => ({
  content: view.content,
  createTime: view.createTime,
  enabled: view.enabled,
  id: view.id,
  name: view.name,
  referenceCount: view.referenceCount,
  remark: view.remark,
  sourceKey: view.sourceKey,
  sourceName: view.sourceName,
  updateTime: view.updateTime,
});

/**
 * Narrows a renderer preview to the public message and example variable values.
 * @param preview - Template service preview result.
 * @returns Detached preview without parser or event internals.
 */
const allowlistPreview = (
  preview: MessageTemplatePreview,
): MessageTemplatePreview => ({
  renderedMessage: preview.renderedMessage,
  variables: structuredClone(preview.variables),
});

@Controller('qqbot/message-push')
@UseGuards(JwtAuthGuard, QqbotMessagePushPermissionGuard)
@UseInterceptors(QqbotMessagePushContractErrorInterceptor)
@UsePipes(
  new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class QqbotMessagePushController {
  /**
   * Initializes global source, subscription, and template management routes.
   * @param sourceRegistry - Process-local public source definitions and adapters.
   * @param subscriptionService - Global subscription lifecycle service.
   * @param templateService - Global template lifecycle and preview service.
   */
  constructor(
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly subscriptionService: QqbotMessageSubscriptionService,
    private readonly templateService: QqbotMessageTemplateService,
  ) {}

  /** Lists detached source definitions available to authorized management flows. */
  @Get('sources')
  @QqbotMessagePushPermission(...SOURCE_READ_PERMISSIONS)
  listSources() {
    return vbenSuccess(this.sourceRegistry.list().map(cloneSourceDefinition));
  }

  /**
   * Returns the concrete STUN configuration candidates without provider state.
   */
  @Get('sources/network.stun.mapping-port-changed/options')
  @QqbotMessagePushPermission(
    'QqBot:MessageSubscription:Create',
    'QqBot:MessageSubscription:Update',
    'QqBot:Account:MessagePush:Create',
    'QqBot:Account:MessagePush:Update',
  )
  async listStunSourceOptions() {
    const result = await this.sourceRegistry
      .get('network.stun.mapping-port-changed')
      .listSubscriptionOptions();
    return vbenSuccess(allowlistStunOptions(result));
  }

  /**
   * Reads one known public source definition.
   * @param params - Validated source key route parameters.
   */
  @Get('sources/:sourceKey')
  @QqbotMessagePushPermission(...SOURCE_READ_PERMISSIONS)
  sourceDetail(@Param() params: MessagePushSourceParamDto) {
    const definition = this.sourceRegistry.get(params.sourceKey).definition;
    return vbenSuccess(cloneSourceDefinition(definition));
  }

  /**
   * Pages global subscriptions.
   * @param query - Strict name, source, enabled, and pagination filters.
   */
  @Get('subscriptions')
  @QqbotMessagePushPermission(
    'QqBot:MessageSubscription:List',
    'QqBot:Account:MessagePush:List',
    'QqBot:Account:MessagePush:Create',
    'QqBot:Account:MessagePush:Update',
  )
  async pageSubscriptions(@Query() query: MessageSubscriptionListQueryDto) {
    const page = await this.subscriptionService.page(query);
    return vbenPage(page.items.map(allowlistSubscription), page.total);
  }

  /**
   * Creates one global subscription.
   * @param body - Complete strict STUN subscription input.
   */
  @Post('subscriptions')
  @HttpCode(HttpStatus.OK)
  @QqbotMessagePushPermission('QqBot:MessageSubscription:Create')
  async createSubscription(@Body() body: MessageSubscriptionInputDto) {
    return vbenSuccess(
      allowlistSubscription(await this.subscriptionService.create(body)),
    );
  }

  /**
   * Replaces one global subscription.
   * @param params - Validated string Snowflake route identity.
   * @param body - Complete strict STUN subscription input.
   */
  @Put('subscriptions/:id')
  @QqbotMessagePushPermission('QqBot:MessageSubscription:Update')
  async updateSubscription(
    @Param() params: MessagePushIdParamDto,
    @Body() body: MessageSubscriptionInputDto,
  ) {
    return vbenSuccess(
      allowlistSubscription(
        await this.subscriptionService.update(params.id, body),
      ),
    );
  }

  /**
   * Toggles one global subscription.
   * @param params - Validated string Snowflake route identity.
   * @param body - Required JSON boolean state.
   */
  @Put('subscriptions/:id/enabled')
  @QqbotMessagePushPermission('QqBot:MessageSubscription:Toggle')
  async toggleSubscription(
    @Param() params: MessagePushIdParamDto,
    @Body() body: MessagePushEnabledDto,
  ) {
    return vbenSuccess(
      allowlistSubscription(
        await this.subscriptionService.setEnabled(params.id, body.enabled),
      ),
    );
  }

  /**
   * Soft-deletes one global subscription.
   * @param params - Validated string Snowflake route identity.
   */
  @Delete('subscriptions/:id')
  @QqbotMessagePushPermission('QqBot:MessageSubscription:Delete')
  async removeSubscription(@Param() params: MessagePushIdParamDto) {
    return vbenSuccess(await this.subscriptionService.remove(params.id));
  }

  /**
   * Pages global templates.
   * @param query - Strict name, source, enabled, and pagination filters.
   */
  @Get('templates')
  @QqbotMessagePushPermission(
    'QqBot:MessageTemplate:List',
    'QqBot:Account:MessagePush:List',
    'QqBot:Account:MessagePush:Create',
    'QqBot:Account:MessagePush:Update',
  )
  async pageTemplates(@Query() query: MessageTemplateListQueryDto) {
    const page = await this.templateService.page(query);
    return vbenPage(page.items.map(allowlistTemplate), page.total);
  }

  /**
   * Creates one global template.
   * @param body - Complete strict source template input.
   */
  @Post('templates')
  @HttpCode(HttpStatus.OK)
  @QqbotMessagePushPermission('QqBot:MessageTemplate:Create')
  async createTemplate(@Body() body: MessageTemplateInputDto) {
    return vbenSuccess(
      allowlistTemplate(await this.templateService.create(body)),
    );
  }

  /**
   * Replaces one global template.
   * @param params - Validated string Snowflake route identity.
   * @param body - Complete strict source template input.
   */
  @Put('templates/:id')
  @QqbotMessagePushPermission('QqBot:MessageTemplate:Update')
  async updateTemplate(
    @Param() params: MessagePushIdParamDto,
    @Body() body: MessageTemplateInputDto,
  ) {
    return vbenSuccess(
      allowlistTemplate(await this.templateService.update(params.id, body)),
    );
  }

  /**
   * Toggles one global template.
   * @param params - Validated string Snowflake route identity.
   * @param body - Required JSON boolean state.
   */
  @Put('templates/:id/enabled')
  @QqbotMessagePushPermission('QqBot:MessageTemplate:Toggle')
  async toggleTemplate(
    @Param() params: MessagePushIdParamDto,
    @Body() body: MessagePushEnabledDto,
  ) {
    return vbenSuccess(
      allowlistTemplate(
        await this.templateService.setEnabled(params.id, body.enabled),
      ),
    );
  }

  /**
   * Soft-deletes one unreferenced global template.
   * @param params - Validated string Snowflake route identity.
   */
  @Delete('templates/:id')
  @QqbotMessagePushPermission('QqBot:MessageTemplate:Delete')
  async removeTemplate(@Param() params: MessagePushIdParamDto) {
    return vbenSuccess(await this.templateService.remove(params.id));
  }

  /**
   * Safely renders one unsaved template with source examples.
   * @param body - Strict source key and content only.
   */
  @Post('templates/preview')
  @HttpCode(HttpStatus.OK)
  @QqbotMessagePushPermission('QqBot:MessageTemplate:Preview')
  previewTemplate(@Body() body: MessageTemplatePreviewDto) {
    return vbenSuccess(allowlistPreview(this.templateService.preview(body)));
  }
}
