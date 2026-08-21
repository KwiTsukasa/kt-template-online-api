import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KtDateTime, throwVbenError } from '@/common';
import {
  LlmConversationCreateDto,
  LlmConversationListQueryDto,
  LlmConversationMessageStreamDto,
} from '../contract/llm.dto';
import type {
  LlmConversationScene,
  LlmTokenUsage,
} from '../contract/llm.types';
import { LlmProviderAdapterRegistry } from '../infrastructure/integration/llm-provider.adapter';
import {
  AdminLlmConversationEntity,
  AdminLlmMessageEntity,
} from '../infrastructure/persistence/llm.entities';
import { LlmConfigService } from './llm-config.service';

const ACTIVE_TURN_STALE_MS = 5 * 60_000;
const MAX_STREAM_TEXT_LENGTH = 1_000_000;

export type LlmConversationStreamEvent =
  | {
      assistantMessageId: string;
      model: string;
      providerThreadId?: string;
      turnId: string;
      type: 'start';
      userMessageId: string;
    }
  | {
      assistantMessageId: string;
      content: string;
      turnId: string;
      type: 'reasoning-delta' | 'text-delta';
    }
  | {
      assistantMessageId: string;
      finishReason?: null | string;
      metadata?: Record<string, unknown>;
      model: string;
      turnId: string;
      type: 'done';
      usage?: LlmTokenUsage;
    };

interface PreparedTurn {
  assistantMessage: AdminLlmMessageEntity;
  conversation: AdminLlmConversationEntity;
  history: Array<{ content: string; role: 'assistant' | 'user' }>;
  model: string;
  reasoningEffort?: string;
  runtime: Awaited<ReturnType<LlmConfigService['runtime']>>;
  serviceTier?: string;
  turnId: string;
  userMessage: AdminLlmMessageEntity;
}

@Injectable()
export class LlmConversationService {
  constructor(
    @InjectRepository(AdminLlmConversationEntity)
    private readonly conversationRepository: Repository<AdminLlmConversationEntity>,
    @InjectRepository(AdminLlmMessageEntity)
    private readonly messageRepository: Repository<AdminLlmMessageEntity>,
    private readonly configs: LlmConfigService,
    private readonly adapters: LlmProviderAdapterRegistry,
  ) {}

  /**
   * 按连接列出最近对话，用于左侧会话导航。
   * @param query - 连接标识与最大返回数量。
   * @returns 按最近消息时间倒序排列的对话摘要。
   */
  async list(query: LlmConversationListQueryDto) {
    await this.configs.detail(query.configId);
    let limit = Number(query.limit || 50);
    if (!Number.isInteger(limit) || limit < 1) limit = 50;
    limit = Math.min(limit, 100);
    const conversations = await this.conversationRepository.find({
      order: { lastMessageAt: 'DESC', createTime: 'DESC' },
      take: limit,
      where: { configId: query.configId, isDeleted: false },
    });
    return conversations.map((item) => this.toConversationView(item));
  }

  /**
   * 把普通对话委托给场景创建边界，初始不固化模型并为空标题提供稳定兜底。
   * @param body - 连接标识与可选标题。
   * @returns 新对话摘要。
   */
  async create(body: LlmConversationCreateDto) {
    return this.createScene(
      body.configId,
      body.title?.trim() || '新对话',
      'general',
      null,
    );
  }

  /**
   * 按 sceneRefId 复用唯一业务对话；并发创建冲突后回读已有记录，普通场景保持独立。
   * @param configId - 当前启用的大模型连接标识。
   * @param title - 对话标题。
   * @param scene - 通用对话或受支持的业务场景。
   * @param sceneRefId - 业务场景引用标识；通用对话传 null。
   * @returns 新建对话摘要。
   * @throws 连接不可用，或业务场景保存失败且无法回读唯一已有对话时抛出错误。
   */
  async createScene(
    configId: string,
    title: string,
    scene: LlmConversationScene,
    sceneRefId: null | string,
  ) {
    const runtime = await this.configs.runtime(configId);
    if (scene !== 'general' && sceneRefId) {
      const existing = await this.findSceneConversation(scene, sceneRefId);
      if (existing) return this.toConversationView(existing);
    }
    const entity = this.conversationRepository.create({
      activeTurnId: null,
      activeTurnStartedAt: null,
      configId: runtime.entity.id,
      isDeleted: false,
      lastMessageAt: null,
      messageCount: 0,
      providerThreadId: null,
      scene,
      sceneRefId,
      selectedModel: null,
      selectedReasoningEffort: null,
      selectedServiceTier: null,
      title: title.trim() || '新对话',
    });
    try {
      return this.toConversationView(
        await this.conversationRepository.save(entity),
      );
    } catch (error) {
      if (scene === 'general' || !sceneRefId) throw error;
      const existing = await this.findSceneConversation(scene, sceneRefId);
      if (existing) return this.toConversationView(existing);
      throw error;
    }
  }

  /**
   * 把未删除对话、脱敏连接和按 sequence 排序的完整消息组合成同一详情快照。
   * @param id - 对话 Snowflake ID。
   * @returns 对话摘要、连接详情和按序消息列表。
   */
  async detail(id: string) {
    const conversation = await this.requireConversation(id);
    const messages = await this.messageRepository.find({
      order: { sequence: 'ASC' },
      where: { conversationId: id },
    });
    return {
      config: await this.configs.detail(conversation.configId),
      conversation: this.toConversationView(conversation),
      messages: messages.map((message) => this.toMessageView(message)),
    };
  }

  /**
   * 从对话表解析唯一业务身份，并按调用方显式提供的 provider thread 执行不可变校验。
   * @param input - 对话、场景、业务引用及可选 provider thread 期望值。
   * @returns 由 `admin_llm_conversation` 权威字段组成的规范身份元组。
   * @throws 对话不存在，或场景、业务引用、provider thread 任一不一致时抛出错误。
   */
  async resolveIdentity(input: {
    activeTurnId?: null | string;
    conversationId: string;
    providerThreadId?: null | string;
    scene: LlmConversationScene;
    sceneRefId: null | string;
  }) {
    const conversation = await this.requireConversation(input.conversationId);
    if (
      conversation.scene !== input.scene ||
      conversation.sceneRefId !== input.sceneRefId
    ) {
      throwVbenError('大模型对话身份不匹配', HttpStatus.CONFLICT);
    }
    if (
      Object.hasOwn(input, 'providerThreadId') &&
      conversation.providerThreadId !== input.providerThreadId
    ) {
      throwVbenError('大模型 provider thread 身份不匹配', HttpStatus.CONFLICT);
    }
    if (
      Object.hasOwn(input, 'activeTurnId') &&
      conversation.activeTurnId !== input.activeTurnId
    ) {
      throwVbenError('大模型对话回合身份不匹配', HttpStatus.CONFLICT);
    }
    return {
      activeTurnId: conversation.activeTurnId,
      conversationId: conversation.id,
      providerThreadId: conversation.providerThreadId,
      scene: conversation.scene,
      sceneRefId: conversation.sceneRefId,
    };
  }

  /**
   * 在活动回合开始供应商 turn 前以 CAS 方式绑定 provider thread，首次为空时写入，已有绑定只允许同值确认。
   * @param input - 对话场景、业务引用、调用方读取的旧线程值及 App Server 实际线程。
   * @returns 完成 CAS 后的规范对话身份元组。
   * @throws 对话、活动回合、场景引用或 provider thread 比较值漂移时抛出错误。
   */
  async bindProviderThread(input: {
    conversationTurnId: string;
    conversationId: string;
    expectedProviderThreadId: null | string;
    providerThreadId: string;
    scene: LlmConversationScene;
    sceneRefId: null | string;
  }) {
    return this.conversationRepository.manager.transaction(async (manager) => {
      const conversationRepository = manager.getRepository(
        AdminLlmConversationEntity,
      );
      const conversation = await conversationRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: input.conversationId, isDeleted: false },
      });
      if (
        !conversation ||
        conversation.activeTurnId !== input.conversationTurnId ||
        conversation.scene !== input.scene ||
        conversation.sceneRefId !== input.sceneRefId ||
        conversation.providerThreadId !== input.expectedProviderThreadId
      ) {
        throwVbenError('大模型对话身份不匹配', HttpStatus.CONFLICT);
      }
      conversation.providerThreadId = this.resolveProviderThreadId(
        conversation,
        input.providerThreadId,
      );
      await conversationRepository.save(conversation);
      return {
        activeTurnId: conversation.activeTurnId,
        conversationId: conversation.id,
        providerThreadId: conversation.providerThreadId,
        scene: conversation.scene,
        sceneRefId: conversation.sceneRefId,
      };
    });
  }

  /**
   * 仅软删除无活动回合的普通对话；业务绑定或生成中的对话保持失败关闭。
   * @param id - 对话 Snowflake ID。
   * @returns 被删除的对话标识。
   */
  async remove(id: string) {
    const conversation = await this.requireConversation(id);
    if (conversation.scene !== 'general') {
      throwVbenError(
        '业务绑定对话必须从对应业务任务进入，不能单独删除',
        HttpStatus.CONFLICT,
      );
    }
    if (conversation.activeTurnId) {
      throwVbenError('生成中的对话不能删除', HttpStatus.CONFLICT);
    }
    await this.conversationRepository.update({ id }, { isDeleted: true });
    return { id };
  }

  /**
   * 按业务场景引用查找唯一的未删除 LLM 对话。
   * @param scene - 非通用业务场景。
   * @param sceneRefId - 业务对象稳定标识。
   * @returns 已存在的唯一场景对话；未创建时返回 null。
   */
  private findSceneConversation(
    scene: LlmConversationScene,
    sceneRefId: string,
  ) {
    return this.conversationRepository.findOne({
      where: { isDeleted: false, scene, sceneRefId },
    });
  }

  /**
   * 锁定对话并写入用户/助手占位消息，随后返回可消费的统一流。
   * @param conversationId - 目标对话 Snowflake ID。
   * @param body - 客户端幂等标识、用户正文和当前选择模型。
   * @param signal - 页面停止生成或连接关闭时传播的取消信号。
   * @returns 逐段产生 start、思考、正文与 done 事件的异步流。
   */
  async prepareStream(
    conversationId: string,
    body: LlmConversationMessageStreamDto,
    signal: AbortSignal,
  ) {
    const prepared = await this.prepareTurn(conversationId, body);
    return this.consumeProviderStream(prepared, body, signal);
  }

  /**
   * 在数据库事务中串行创建一次回合并恢复可发送历史。
   * @param conversationId - 目标对话 Snowflake ID。
   * @param body - 用户消息和模型选择。
   * @returns 回合、消息、实时校验后的模型、运行配置和上游历史。
   */
  private async prepareTurn(
    conversationId: string,
    body: LlmConversationMessageStreamDto,
  ): Promise<PreparedTurn> {
    const snapshot = await this.requireConversation(conversationId);
    const runtime = await this.configs.runtime(snapshot.configId);
    const selection = await this.configs.resolveModelSelection(
      runtime,
      body.model,
      body.reasoningEffort,
      body.serviceTier,
    );
    const model = selection.model;
    const result = await this.conversationRepository.manager.transaction(
      async (manager) => {
        const conversationRepository = manager.getRepository(
          AdminLlmConversationEntity,
        );
        const messageRepository = manager.getRepository(AdminLlmMessageEntity);
        const conversation = await conversationRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          where: { id: conversationId, isDeleted: false },
        });
        if (!conversation) {
          throwVbenError('大模型对话不存在', HttpStatus.NOT_FOUND);
        }
        const reclaimedStaleTurn = this.assertTurnAvailable(conversation);
        if (reclaimedStaleTurn && conversation.messageCount > 0) {
          await messageRepository.update(
            {
              conversationId,
              role: 'assistant',
              sequence: conversation.messageCount,
              status: 'streaming',
            },
            { errorMessage: null, status: 'interrupted' },
          );
        }
        const duplicated = await messageRepository.findOne({
          where: {
            clientMessageId: body.clientMessageId,
            conversationId,
          },
        });
        if (duplicated) {
          throwVbenError('该消息已经提交', HttpStatus.CONFLICT);
        }
        const turnId = randomUUID();
        const now = new KtDateTime();
        const userMessage = messageRepository.create({
          clientMessageId: body.clientMessageId,
          content: body.content,
          conversationId,
          errorMessage: null,
          finishReason: null,
          metadata: null,
          model: null,
          reasoningContent: null,
          role: 'user',
          sequence: conversation.messageCount + 1,
          status: 'completed',
          usage: null,
        });
        const assistantMessage = messageRepository.create({
          clientMessageId: null,
          content: '',
          conversationId,
          errorMessage: null,
          finishReason: null,
          metadata: null,
          model,
          reasoningContent: null,
          role: 'assistant',
          sequence: conversation.messageCount + 2,
          status: 'streaming',
          usage: null,
        });
        await messageRepository.save([userMessage, assistantMessage]);
        conversation.activeTurnId = turnId;
        conversation.activeTurnStartedAt = now;
        conversation.lastMessageAt = now;
        conversation.messageCount += 2;
        conversation.selectedModel = model;
        conversation.selectedReasoningEffort =
          selection.reasoningEffort || null;
        conversation.selectedServiceTier = selection.serviceTier || null;
        if (conversation.messageCount === 2) {
          conversation.title = this.titleFromMessage(body.content);
        }
        await conversationRepository.save(conversation);
        return { assistantMessage, conversation, turnId, userMessage };
      },
    );
    const historyRows = await this.messageRepository
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId })
      .andWhere('message.sequence <= :sequence', {
        sequence: result.userMessage.sequence,
      })
      .andWhere('message.status = :status', { status: 'completed' })
      .orderBy('message.sequence', 'ASC')
      .getMany();
    const history = historyRows.map((message) => ({
      content: message.content,
      role: message.role,
    }));
    return {
      ...result,
      history,
      model,
      reasoningEffort: selection.reasoningEffort,
      runtime,
      serviceTier: selection.serviceTier,
    };
  }

  /**
   * 消费供应商流，累积正文/思考并在成功、取消或失败时原子落库。
   * @param prepared - 已持久化占位消息和上游上下文。
   * @param body - 当前客户端消息正文与幂等标识。
   * @param signal - 页面取消信号。
   * @returns 浏览器稳定事件流。
   * @throws 供应商缺少 start/done、流消费或终态持久化失败时先落失败状态再重新抛出。
   */
  private async *consumeProviderStream(
    prepared: PreparedTurn,
    body: LlmConversationMessageStreamDto,
    signal: AbortSignal,
  ): AsyncGenerator<LlmConversationStreamEvent> {
    const adapter = this.adapters.resolve(prepared.runtime.entity.provider);
    let actualModel = prepared.model;
    let content = '';
    let finishReason: null | string = null;
    let providerThreadId = prepared.conversation.providerThreadId;
    let reasoningContent = '';
    let receivedDone = false;
    let started = false;
    let metadata: Record<string, unknown> | undefined;
    let usage: LlmTokenUsage | undefined;
    try {
      for await (const event of adapter.stream({
        clientMessageId: body.clientMessageId,
        config: prepared.runtime.adapterConfig,
        context: this.streamContext(prepared.conversation, prepared.turnId),
        messages: prepared.history,
        model: prepared.model,
        providerThreadId,
        reasoningEffort: prepared.reasoningEffort,
        serviceTier: prepared.serviceTier,
        signal,
      })) {
        if (event.type === 'start') {
          actualModel = event.model;
          if (event.providerThreadId) {
            providerThreadId = event.providerThreadId;
            await this.persistProviderThread(
              prepared.conversation.id,
              prepared.turnId,
              providerThreadId,
            );
          }
          started = true;
          const startEvent: LlmConversationStreamEvent = {
            assistantMessageId: prepared.assistantMessage.id,
            model: actualModel,
            turnId: prepared.turnId,
            type: 'start',
            userMessageId: prepared.userMessage.id,
          };
          if (providerThreadId) {
            startEvent.providerThreadId = providerThreadId;
          }
          yield startEvent;
          continue;
        }
        if (event.type === 'reasoning-delta') {
          reasoningContent += event.content;
          this.assertStreamLength(reasoningContent, content);
          yield {
            assistantMessageId: prepared.assistantMessage.id,
            content: event.content,
            turnId: prepared.turnId,
            type: 'reasoning-delta',
          };
          continue;
        }
        if (event.type === 'text-delta') {
          content += event.content;
          this.assertStreamLength(reasoningContent, content);
          yield {
            assistantMessageId: prepared.assistantMessage.id,
            content: event.content,
            turnId: prepared.turnId,
            type: 'text-delta',
          };
          continue;
        }
        if (event.type !== 'done') continue;
        actualModel = event.model;
        finishReason = event.finishReason || null;
        metadata = event.metadata;
        usage = event.usage;
        if (event.providerThreadId) providerThreadId = event.providerThreadId;
        receivedDone = true;
      }
      if (!started) {
        throw new Error('供应商流缺少 start 事件');
      }
      if (!receivedDone) {
        throw new Error('供应商流缺少 done 事件');
      }
      await this.finalizeTurn(prepared, {
        actualModel,
        content,
        errorMessage: null,
        finishReason,
        providerThreadId,
        reasoningContent,
        status: 'completed',
        metadata,
        usage,
      });
      yield {
        assistantMessageId: prepared.assistantMessage.id,
        finishReason,
        metadata,
        model: actualModel,
        turnId: prepared.turnId,
        type: 'done',
        usage,
      };
    } catch (error) {
      let status: 'failed' | 'interrupted' = 'failed';
      let errorMessage: null | string = this.safeErrorMessage(error);
      if (signal.aborted || errorMessage === 'llm-stream-aborted') {
        status = 'interrupted';
        errorMessage = null;
      }
      await this.finalizeTurn(prepared, {
        actualModel,
        content,
        errorMessage,
        finishReason,
        providerThreadId,
        reasoningContent,
        status,
        metadata,
        usage,
      });
      throw error;
    }
  }

  /**
   * 锁定匹配活动回合后首次绑定 provider thread，并拒绝迟到流或上游返回的另一线程覆盖既有身份。
   * @param conversationId - 对话 Snowflake ID。
   * @param turnId - 当前活动回合 UUID。
   * @param providerThreadId - App Server 返回的持久线程标识。
   * @throws 活动回合已变化或既有 provider thread 与返回值不一致时抛出错误。
   */
  private async persistProviderThread(
    conversationId: string,
    turnId: string,
    providerThreadId: string,
  ) {
    await this.conversationRepository.manager.transaction(async (manager) => {
      const conversationRepository = manager.getRepository(
        AdminLlmConversationEntity,
      );
      const conversation = await conversationRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: conversationId, isDeleted: false },
      });
      if (!conversation || conversation.activeTurnId !== turnId) {
        throw new Error('大模型对话活动回合已变化');
      }
      conversation.providerThreadId = this.resolveProviderThreadId(
        conversation,
        providerThreadId,
      );
      await conversationRepository.save(conversation);
    });
  }

  /**
   * 原子写入助手终态并清除匹配的活动回合。
   * @param prepared - 当前回合持久化上下文。
   * @param result - 累积正文、思考、模型、终止状态和可选用量。
   */
  private async finalizeTurn(
    prepared: PreparedTurn,
    result: {
      actualModel: string;
      content: string;
      errorMessage: null | string;
      finishReason: null | string;
      metadata?: Record<string, unknown>;
      providerThreadId: null | string;
      reasoningContent: string;
      status: 'completed' | 'failed' | 'interrupted';
      usage?: LlmTokenUsage;
    },
  ) {
    await this.conversationRepository.manager.transaction(async (manager) => {
      const conversationRepository = manager.getRepository(
        AdminLlmConversationEntity,
      );
      const messageRepository = manager.getRepository(AdminLlmMessageEntity);
      const conversation = await conversationRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: prepared.conversation.id, isDeleted: false },
      });
      if (!conversation || conversation.activeTurnId !== prepared.turnId) {
        throw new Error('大模型对话活动回合已变化');
      }
      await messageRepository.update(
        { id: prepared.assistantMessage.id },
        {
          content: result.content,
          errorMessage: result.errorMessage,
          finishReason: result.finishReason,
          metadata: result.metadata || null,
          model: result.actualModel,
          reasoningContent: result.reasoningContent || null,
          status: result.status,
          usage: result.usage || null,
        },
      );
      conversation.activeTurnId = null;
      conversation.activeTurnStartedAt = null;
      conversation.providerThreadId = this.resolveProviderThreadId(
        conversation,
        result.providerThreadId,
      );
      conversation.selectedModel = result.actualModel;
      conversation.lastMessageAt = new KtDateTime();
      await conversationRepository.save(conversation);
    });
  }

  /**
   * 将首次返回的 provider thread 固化到对话；已有绑定只允许同值重入。
   * @param conversation - 当前已加写锁的权威对话记录。
   * @param providerThreadId - 本轮供应商流返回或继承的线程标识。
   * @returns 可写回对话表且不会改变既有绑定的 provider thread。
   * @throws 已有非空绑定与本轮线程不同或本轮丢失既有线程时抛出错误。
   */
  private resolveProviderThreadId(
    conversation: AdminLlmConversationEntity,
    providerThreadId: null | string,
  ) {
    if (conversation.providerThreadId === null) return providerThreadId;
    if (conversation.providerThreadId !== providerThreadId) {
      throw new Error('llm-provider-thread-identity-mismatch');
    }
    return conversation.providerThreadId;
  }

  /**
   * 拒绝仍在有效窗口内的并发回合，陈旧活动标识允许当前请求接管。
   * @param conversation - 已加写锁的对话实体。
   * @returns 清理了陈旧活动回合时返回 true。
   */
  private assertTurnAvailable(
    conversation: AdminLlmConversationEntity,
  ): boolean {
    if (!conversation.activeTurnId) return false;
    let stale = true;
    if (conversation.activeTurnStartedAt) {
      stale =
        Date.now() - conversation.activeTurnStartedAt.getTime() >=
        ACTIVE_TURN_STALE_MS;
    }
    if (!stale) {
      throwVbenError('当前对话正在生成，请先停止', HttpStatus.CONFLICT);
    }
    conversation.activeTurnId = null;
    conversation.activeTurnStartedAt = null;
    return true;
  }

  /**
   * 将非通用对话投影为供应商适配器场景上下文。
   * @param conversation - 当前持久化对话。
   * @param conversationTurnId - API 已锁定的活动回合标识。
   * @returns 业务场景上下文；通用对话返回 undefined。
   */
  private streamContext(
    conversation: AdminLlmConversationEntity,
    conversationTurnId: string,
  ) {
    if (conversation.scene === 'general' || !conversation.sceneRefId) {
      return undefined;
    }
    return {
      conversationTurnId,
      conversationId: conversation.id,
      scene: conversation.scene,
      sceneRefId: conversation.sceneRefId,
    };
  }

  /**
   * 限制单次助手正文与思考累计长度，避免异常上游耗尽内存。
   * @param reasoningContent - 已累计的思考文本。
   * @param content - 已累计的最终回答文本。
   * @throws 总字符数超过上限时抛出错误。
   */
  private assertStreamLength(reasoningContent: string, content: string) {
    if (reasoningContent.length + content.length > MAX_STREAM_TEXT_LENGTH) {
      throw new Error('大模型流式文本超过安全上限');
    }
  }

  /**
   * 读取未删除对话，不存在时返回 404。
   * @param id - 对话 Snowflake ID。
   * @returns 未删除的对话实体。
   */
  private async requireConversation(id: string) {
    const conversation = await this.conversationRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!conversation) {
      throwVbenError('大模型对话不存在', HttpStatus.NOT_FOUND);
    }
    return conversation;
  }

  /**
   * 折叠首条用户消息的连续空白并截断到四十字符；空正文回退为“新对话”。
   * @param content - 首条用户消息正文。
   * @returns 去除连续空白并截断到 40 字符的标题。
   */
  private titleFromMessage(content: string): string {
    const title = content.replace(/\s+/g, ' ').trim().slice(0, 40);
    return title || '新对话';
  }

  /**
   * 把未知异常转换为不含请求配置和凭据的短文本。
   * @param error - 供应商或持久化阶段抛出的未知错误。
   * @returns 最长 500 字符的单行错误。
   */
  private safeErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, 500);
    }
    return '大模型流式请求失败';
  }

  /**
   * 把对话实体投影为左侧列表与详情头共用结构。
   * @param conversation - 数据库对话实体。
   * @returns 不含内部活动回合时间的会话视图。
   */
  private toConversationView(conversation: AdminLlmConversationEntity) {
    return {
      active: !!conversation.activeTurnId,
      configId: conversation.configId,
      createTime: conversation.createTime,
      id: conversation.id,
      lastMessageAt: conversation.lastMessageAt,
      messageCount: conversation.messageCount,
      scene: conversation.scene,
      sceneRefId: conversation.sceneRefId,
      selectedModel: conversation.selectedModel,
      selectedReasoningEffort: conversation.selectedReasoningEffort,
      selectedServiceTier: conversation.selectedServiceTier,
      title: conversation.title,
      updateTime: conversation.updateTime,
    };
  }

  /**
   * 把消息实体投影为可渲染历史并保留实际助手模型。
   * @param message - 数据库消息实体。
   * @returns 对话页可见消息结构。
   */
  private toMessageView(message: AdminLlmMessageEntity) {
    return {
      content: message.content,
      createTime: message.createTime,
      errorMessage: message.errorMessage,
      finishReason: message.finishReason,
      id: message.id,
      metadata: message.metadata,
      model: message.model,
      reasoningContent: message.reasoningContent,
      role: message.role,
      sequence: message.sequence,
      status: message.status,
      usage: message.usage,
    };
  }
}
