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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { QqbotMessageSubscriptionService } from '../../application/message-push/qqbot-message-subscription.service';
import { QqbotMessageTemplateService } from '../../application/message-push/qqbot-message-template.service';
import { SystemMessageSourceRegistry } from '../../application/message-push/system-message-source.registry';
import type {
  MessageSubscriptionView,
  MessageTemplatePreview,
  MessageTemplateView,
  StunMappingPortChangedOptionsResponse,
  SystemMessageSourceDefinition,
  SystemMessageSourceOptionsResponse,
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

const SOURCE_OPTIONS_PERMISSIONS = [
  'QqBot:MessageSubscription:Create',
  'QqBot:MessageSubscription:Update',
  'QqBot:Account:MessagePush:Create',
  'QqBot:Account:MessagePush:Update',
] as const;

const LEGACY_STUN_SOURCE_KEY = 'network.stun.mapping-port-changed';

const cloneSourceDefinition = (
  definition: SystemMessageSourceDefinition,
): SystemMessageSourceDefinition => ({
  description: definition.description,
  displayName: definition.displayName,
  sourceKey: definition.sourceKey,
  subscriptionFields: definition.subscriptionFields.map((field) => ({
    ...((() => {
      if (field.dependsOn === undefined) {
        return {};
      }
      return { dependsOn: field.dependsOn };
    })()),
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

const allowlistSourceOptions = (
  definition: SystemMessageSourceDefinition,
  value: SystemMessageSourceOptionsResponse,
): SystemMessageSourceOptionsResponse =>
  Object.fromEntries(
    [
      ...new Set(
        definition.subscriptionFields.map((field) => field.optionCollection),
      ),
    ].map((collection) => [
      collection,
      (value[collection] || []).map((item) => ({
        ...((() => {
          if (item.dependsOnValue === undefined) {
            return {};
          }
          return { dependsOnValue: item.dependsOnValue };
        })()),
        disabled: item.disabled,
        disabledReasonCode: item.disabledReasonCode,
        label: item.label,
        value: item.value,
      })),
    ]),
  );

/**
 * 为旧版 Admin 保留一个发布周期的 STUN 候选项响应。
 * @param value - 参与为旧版 Admin 保留一个发布周期的 STUN 候选项响应比较、格式化或输出的候选值。
 * @returns 包含 `ddnsRecords`、`portForwards` 字段的为旧版 Admin 保留一个发布周期的 STUN 候选项响应。
 */
function allowlistLegacyStunOptions(
  value: SystemMessageSourceOptionsResponse,
): StunMappingPortChangedOptionsResponse {
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
}

const allowlistSubscription = (
  view: MessageSubscriptionView,
  definition: SystemMessageSourceDefinition,
): MessageSubscriptionView => {
  const input =
    (() => {
      if (view.sourceConfig &&
    typeof view.sourceConfig === 'object' &&
    !Array.isArray(view.sourceConfig)) {
        return view.sourceConfig;
      }
      return {};
    })();
  const sourceConfig = Object.fromEntries(
    definition.subscriptionFields.flatMap((field) => {
      const value = input[field.key];
      if (Object.prototype.hasOwnProperty.call(input, field.key) &&
        typeof value === 'string') {
        return [[field.key, value]];
      }
      return [];
    }),
  );
  return {
    createTime: view.createTime,
    enabled: view.enabled,
    id: view.id,
    invalidReasonCode: view.invalidReasonCode,
    name: view.name,
    remark: view.remark,
    sourceConfig,
    sourceKey: view.sourceKey,
    sourceName: view.sourceName,
    sourceSummary: view.sourceSummary,
    updateTime: view.updateTime,
    valid: view.valid,
  };
};

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
  constructor(
    private readonly sourceRegistry: SystemMessageSourceRegistry,
    private readonly subscriptionService: QqbotMessageSubscriptionService,
    private readonly templateService: QqbotMessageTemplateService,
  ) {}

  /**
   * 按当前运行态读取来源；从 `sourceRegistry.list` 读取来源。
   * @returns 来源。
   */
  @Get('sources')
  @QqbotMessagePushPermission(...SOURCE_READ_PERMISSIONS)
  listSources() {
    return vbenSuccess(this.sourceRegistry.list().map(cloneSourceDefinition));
  }

  /**
   * 从当前数据源读取消息源动态订阅表单使用的标准候选项。
   * @param params - 用于消息源动态订阅表单使用的标准候选项的领域对象，包含 `sourceKey` 字段。
   * @returns 消息源动态订阅表单使用的标准候选项。
   */
  @Get('sources/:sourceKey/subscription-options')
  @QqbotMessagePushPermission(...SOURCE_OPTIONS_PERMISSIONS)
  async listSourceOptions(@Param() params: MessagePushSourceParamDto) {
    const adapter = this.sourceRegistry.get(params.sourceKey);
    const result = await adapter.listSubscriptionOptions();
    return vbenSuccess(allowlistSourceOptions(adapter.definition, result));
  }

  /**
   * 返回旧版 Admin 使用的 STUN 专用候选项。
   * @returns 旧版 Admin 使用的 STUN 专用候选项。
   */
  @Get('sources/network.stun.mapping-port-changed/options')
  @QqbotMessagePushPermission(...SOURCE_OPTIONS_PERMISSIONS)
  async listLegacyStunOptions() {
    const result = await this.sourceRegistry
      .get(LEGACY_STUN_SOURCE_KEY)
      .listSubscriptionOptions();
    return vbenSuccess(allowlistLegacyStunOptions(result));
  }

  /**
   * 查询领域服务并组装管理端来源详情。
   * @param params - 用于来源详情的领域对象，包含 `sourceKey` 字段。
   * @returns 来源详情。
   */
  @Get('sources/:sourceKey')
  @QqbotMessagePushPermission(...SOURCE_READ_PERMISSIONS)
  sourceDetail(@Param() params: MessagePushSourceParamDto) {
    const definition = this.sourceRegistry.get(params.sourceKey).definition;
    return vbenSuccess(cloneSourceDefinition(definition));
  }

  /**
   * 查询领域服务并组装管理端页面订阅。
   * @param query - 限定页面订阅筛选、排序与分页范围的查询条件。
   * @returns 页面订阅。
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
    return vbenPage(
      page.items.map((item) =>
        allowlistSubscription(
          item,
          this.sourceRegistry.get(item.sourceKey).definition,
        ),
      ),
      page.total,
    );
  }

  /**
   * 根据`body`构造订阅；从 `sourceRegistry.get` 读取订阅。
   * @param body - 用于订阅的结构化输入。
   * @returns 订阅。
   */
  @Post('subscriptions')
  @HttpCode(HttpStatus.OK)
  @QqbotMessagePushPermission('QqBot:MessageSubscription:Create')
  async createSubscription(@Body() body: MessageSubscriptionInputDto) {
    const view = await this.subscriptionService.create(body);
    return vbenSuccess(
      allowlistSubscription(
        view,
        this.sourceRegistry.get(view.sourceKey).definition,
      ),
    );
  }

  /**
   * 根据`params`、`body`更新订阅；从 `sourceRegistry.get` 读取订阅。
   * @param params - 用于订阅的领域对象，包含 `id` 字段。
   * @param body - 用于订阅的结构化输入。
   * @returns 订阅。
   */
  @Put('subscriptions/:id')
  @QqbotMessagePushPermission('QqBot:MessageSubscription:Update')
  async updateSubscription(
    @Param() params: MessagePushIdParamDto,
    @Body() body: MessageSubscriptionInputDto,
  ) {
    const view = await this.subscriptionService.update(params.id, body);
    return vbenSuccess(
      allowlistSubscription(
        view,
        this.sourceRegistry.get(view.sourceKey).definition,
      ),
    );
  }

  /**
   * 将输入收敛并投影为切换订阅。
   * @param params - 用于切换订阅的领域对象，包含 `id` 字段。
   * @param body - 用于切换订阅的结构化输入，包含 `enabled` 字段。
   * @returns 切换订阅。
   */
  @Put('subscriptions/:id/enabled')
  @QqbotMessagePushPermission('QqBot:MessageSubscription:Toggle')
  async toggleSubscription(
    @Param() params: MessagePushIdParamDto,
    @Body() body: MessagePushEnabledDto,
  ) {
    const view = await this.subscriptionService.setEnabled(
      params.id,
      body.enabled,
    );
    return vbenSuccess(
      allowlistSubscription(
        view,
        this.sourceRegistry.get(view.sourceKey).definition,
      ),
    );
  }

  /**
   * 按订阅标识删除消息推送订阅，并封装删除后的成功响应。
   * @param params - 用于订阅的领域对象，包含 `id` 字段。
   * @returns 订阅。
   */
  @Delete('subscriptions/:id')
  @QqbotMessagePushPermission('QqBot:MessageSubscription:Delete')
  async removeSubscription(@Param() params: MessagePushIdParamDto) {
    return vbenSuccess(await this.subscriptionService.remove(params.id));
  }

  /**
   * 查询领域服务并组装管理端页面模板。
   * @param query - 限定页面模板筛选、排序与分页范围的查询条件。
   * @returns 页面模板。
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
   * 根据请求体创建消息推送模板，并返回新模板的管理视图。
   * @param body - 用于模板的结构化输入。
   * @returns 模板。
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
   * 按模板标识应用请求体变更，并返回更新后的消息模板视图。
   * @param params - 用于模板的领域对象，包含 `id` 字段。
   * @param body - 用于模板的结构化输入。
   * @returns 模板。
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
   * 将输入收敛并投影为切换模板。
   * @param params - 用于切换模板的领域对象，包含 `id` 字段。
   * @param body - 用于切换模板的结构化输入，包含 `enabled` 字段。
   * @returns 切换模板。
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
   * 按模板标识删除消息推送模板，并封装删除后的成功响应。
   * @param params - 用于模板的领域对象，包含 `id` 字段。
   * @returns 模板。
   */
  @Delete('templates/:id')
  @QqbotMessagePushPermission('QqBot:MessageTemplate:Delete')
  async removeTemplate(@Param() params: MessagePushIdParamDto) {
    return vbenSuccess(await this.templateService.remove(params.id));
  }

  /**
   * 查询领域服务并组装管理端预览模板。
   * @param body - 用于预览模板的结构化输入。
   * @returns 预览模板。
   */
  @Post('templates/preview')
  @HttpCode(HttpStatus.OK)
  @QqbotMessagePushPermission('QqBot:MessageTemplate:Preview')
  previewTemplate(@Body() body: MessageTemplatePreviewDto) {
    return vbenSuccess(allowlistPreview(this.templateService.preview(body)));
  }
}
