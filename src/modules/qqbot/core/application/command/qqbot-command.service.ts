import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { QqbotAccountService } from '../account/qqbot-account.service';
import {
  QQBOT_PLUGIN_EXECUTION_PORT,
  type QqbotPluginExecutionPort,
} from '../../domain/plugin-execution.port';
import {
  QQBOT_DEFAULT_PAGE_NO,
  QQBOT_DEFAULT_PAGE_SIZE,
} from '../../contract/qqbot.constants';
import type {
  QqbotCommandParserType,
  QqbotNormalizedMessage,
  QqbotRuleTargetType,
} from '../../contract/qqbot.types';
import type {
  QqbotCommandBodyDto,
  QqbotCommandQueryDto,
  QqbotCommandUpdateDto,
} from '../../contract/command/qqbot-command.dto';
import { isWithinCooldown } from '../../domain/qqbot-cooldown.policy';
import { QqbotCommandLog } from '../../infrastructure/persistence/command/qqbot-command-log.entity';
import { QqbotCommand } from '../../infrastructure/persistence/command/qqbot-command.entity';

@Injectable()
export class QqbotCommandService {
  constructor(
    @InjectRepository(QqbotCommand)
    private readonly commandRepository: Repository<QqbotCommand>,
    @InjectRepository(QqbotCommandLog)
    private readonly commandLogRepository: Repository<QqbotCommandLog>,
    private readonly accountService: QqbotAccountService,
    @Inject(QQBOT_PLUGIN_EXECUTION_PORT)
    private readonly pluginExecution: QqbotPluginExecutionPort,
    private readonly toolsService: ToolsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 按命令查询条件筛选未删除记录并分页，结果保持命令管理列表的固定排序。
   * @param query - 限定按命令查询条件筛选未删除记录并分页，结果保持命令管理列表的固定排序筛选、排序与分页范围的查询条件，包含 `keyword`、`selfId`、`pluginKey`、`operationKey` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的按命令查询条件筛选未删除记录并分页，结果保持命令管理列表的固定排序。
   */
  async page(query: QqbotCommandQueryDto) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(
      query,
      QQBOT_DEFAULT_PAGE_NO,
      QQBOT_DEFAULT_PAGE_SIZE,
    );
    const builder = this.commandRepository
      .createQueryBuilder('command')
      .where('command.isDeleted = :isDeleted', { isDeleted: false });

    if (query.keyword) {
      builder.andWhere(
        '(command.code LIKE :keyword OR command.name LIKE :keyword OR command.aliases LIKE :keyword)',
        { keyword: `%${query.keyword}%` },
      );
    }
    if (query.selfId) {
      const boundIds = await this.accountService.getBoundCommandIds(
        query.selfId,
      );
      if (boundIds.length === 0) {
        return { list: [], pageNo, pageSize, total: 0 };
      }
      builder.andWhere('command.id IN (:...boundIds)', { boundIds });
    }
    if (query.pluginKey) {
      builder.andWhere('command.pluginKey = :pluginKey', {
        pluginKey: query.pluginKey,
      });
    }
    if (query.operationKey) {
      builder.andWhere('command.operationKey = :operationKey', {
        operationKey: query.operationKey,
      });
    }
    if (query.targetType) {
      builder.andWhere('command.targetType = :targetType', {
        targetType: query.targetType,
      });
    }
    if (query.enabled !== undefined && `${query.enabled}` !== '') {
      builder.andWhere('command.enabled = :enabled', {
        enabled: this.toolsService.normalizeBoolean(query.enabled),
      });
    }

    const [list, total] = await builder
      .orderBy('command.priority', 'DESC')
      .addOrderBy('command.createTime', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();
    return {
      list: list.map((item) => this.toResponse(item)),
      pageNo,
      pageSize,
      total,
    };
  }

  /**
   * 按`message`读取启用状态消息；把变更持久化到当前存储（`commandRepository.createQueryBuilder`）。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `selfId`、`messageType` 字段。
   * @returns 启用状态消息。
   */
  async listEnabledForMessage(message: QqbotNormalizedMessage) {
    const [boundIds, boundPluginKeys] = await Promise.all([
      this.accountService.getBoundCommandIds(message.selfId),
      this.pluginExecution.listBoundPluginKeys(message.selfId),
    ]);
    if (boundIds.length === 0 || boundPluginKeys.length === 0) return [];
    return this.commandRepository
      .createQueryBuilder('command')
      .where('command.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('command.enabled = :enabled', { enabled: true })
      .andWhere('command.id IN (:...boundIds)', { boundIds })
      .andWhere('command.pluginKey IN (:...boundPluginKeys)', {
        boundPluginKeys,
      })
      .andWhere('command.targetType IN (:...targetTypes)', {
        targetTypes: ['all', message.messageType],
      })
      .orderBy('command.priority', 'DESC')
      .addOrderBy('command.createTime', 'ASC')
      .getMany();
  }

  /**
   * 绑定账号在线命令前先恢复对应插件的平台账号绑定，确保官方与 NapCat 使用同一执行门禁。
   * @param selfId - NapCat QQ 号或 QQ 官方账号稳定键。
   * @param commandId - 待绑定在线命令主键。
   * @returns 命令能力与平台插件绑定均写入完成时返回 true。
   */
  async bindAccountCommand(
    selfId: string,
    commandId: string,
  ): Promise<boolean> {
    const command = await this.findById(commandId);
    await this.pluginExecution.bindAccountPlugin({
      pluginKey: command.pluginKey,
      selfId,
    });
    return this.accountService.bindCommand(selfId, commandId);
  }

  /**
   * 按`id`读取标识；从 `commandRepository.findOne` 读取标识。
   * @param id - 决定标识内容、边界或目标的 `id` 值。
   * @returns 标识。
   */
  async findById(id: string) {
    const command = await this.commandRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!command) throwVbenError('命令不存在');
    return command;
  }

  /**
   * 根据`body`更新`save` 对应结果；把变更持久化到当前存储（`commandRepository.save`）。
   * @param body - 用于`save` 对应结果的结构化输入。
   * @returns `save` 对应。
   */
  async save(body: QqbotCommandBodyDto) {
    const payload = await this.normalizeBody(body);
    await this.assertCodeAvailable(payload.code || '');
    const saved = await this.commandRepository.save(
      this.commandRepository.create(payload),
    );
    return saved.id;
  }

  /**
   * 根据`body`更新`update` 对应结果；把变更持久化到当前存储（`commandRepository.update`）。
   * @param body - 用于`update` 对应结果的结构化输入，包含 `id` 字段。
   * @returns 满足`update` 对应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async update(body: QqbotCommandUpdateDto) {
    const current = await this.findById(body.id);
    const payload = await this.normalizeBody({
      ...this.toRawBody(current),
      ...body,
    });
    await this.assertCodeAvailable(payload.code || '', body.id);
    await this.commandRepository.update({ id: body.id }, payload);
    return true;
  }

  /**
   * 按命令标识设置软删除标记，写入完成后固定返回 `true`。
   * @param id - 决定按命令标识设置软删除标记，写入完成后固定返回 `true`内容、边界或目标的 `id` 值。
   * @returns 满足按命令标识设置软删除标记，写入完成后固定返回 `true`约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async remove(id: string) {
    await this.commandRepository.update({ id }, { isDeleted: true });
    return true;
  }

  /**
   * 按命令标识更新启用状态，写入完成后固定返回 `true`。
   * @param id - 决定按命令标识更新启用状态，写入完成后固定返回 `true`内容、边界或目标的 `id` 值。
   * @param enabled - 决定按命令标识更新启用状态，写入完成后固定返回 `true`内容、边界或目标的 `enabled` 值。
   * @returns 满足按命令标识更新启用状态，写入完成后固定返回 `true`约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async toggle(id: string, enabled: boolean) {
    await this.commandRepository.update({ id }, { enabled });
    return true;
  }

  /**
   * 按命令标识将最后命中时间更新为当前时间。
   * @param command - 用于按命令标识将最后命中时间更新为当前时间的领域对象，包含 `id` 字段。
   */
  async markHit(command: QqbotCommand) {
    await this.commandRepository.update(
      { id: command.id },
      { lastHitAt: new Date() },
    );
  }

  /**
   * 通过 `isWithinCooldown` 判断输入是否满足函数约束。
   * @param command - 用于冷却时间的领域对象，包含 `cooldownMs`、`lastHitAt` 字段。
   * @returns 满足冷却时间约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  isInCooldown(command: QqbotCommand) {
    return isWithinCooldown({
      cooldownMs: command.cooldownMs,
      lastHitAt: command.lastHitAt,
      minCooldownMs: this.getMinCooldownMs(),
    });
  }

  /**
   * 根据`params`处理日志Execution；把变更持久化到当前存储（`commandLogRepository.save`）。
   * @param params - 用于日志Execution的领域对象，包含 `command`、`errorMessage`、`input`、`output` 字段。
   */
  async logExecution(params: {
    command: QqbotCommand;
    errorMessage?: string;
    input: Record<string, any>;
    message: QqbotNormalizedMessage;
    output?: any;
    status: 'failed' | 'success';
  }) {
    await this.commandLogRepository.save(
      this.commandLogRepository.create({
        commandCode: params.command.code,
        commandId: params.command.id,
        errorMessage: params.errorMessage || null,
        input: JSON.stringify(params.input || {}),
        operationKey: params.command.operationKey,
        output: (() => {
          if (params.output === undefined) {
            return null;
          }
          return this.stringifyStoredOutput(params.output);
        })(),
        pluginKey: params.command.pluginKey,
        rawMessage: params.message.messageText,
        selfId: params.message.selfId,
        status: params.status,
        targetId: params.message.targetId,
        targetType: params.message.messageType,
        userId: params.message.userId,
      }),
    );
  }

  /**
   * 将命令持久化的默认参数 JSON 解析为运行时参数结构，并沿用统一解析回退语义。
   * @param command - 用于参数的领域对象，包含 `defaultParams` 字段。
   * @returns 参数。
   */
  parseDefaultParams(command: QqbotCommand) {
    return this.parseJson(command.defaultParams);
  }

  /**
   * 将命令持久化字段转换为接口响应，并解析别名、前缀与默认参数 JSON。
   * @param command - 用于响应的领域对象，包含 `aliases`、`prefixes` 字段。
   * @returns 包含 `aliases`、`defaultParams`、`prefixes` 字段的响应。
   */
  toResponse(command: QqbotCommand) {
    return {
      ...command,
      aliases: this.parseList(command.aliases),
      defaultParams: this.parseDefaultParams(command),
      prefixes: this.parseList(command.prefixes),
    };
  }

  /**
   * 将`body`规范为请求内容，使等价输入得到一致表示；先通过 `assertPluginOperation` 校验输入边界。
   * @param body - 用于请求内容的结构化输入，包含 `code`、`pluginKey`、`operationKey`、`name` 字段。
   * @returns 包含 `aliases`、`code`、`cooldownMs`、`defaultParams`、`enabled` 字段的请求内容。
   */
  private async normalizeBody(body: QqbotCommandBodyDto) {
    const code = `${body.code || ''}`.trim();
    const pluginKey = `${body.pluginKey || ''}`.trim();
    const operationKey = `${body.operationKey || ''}`.trim();
    if (!code) throwVbenError('命令编码不能为空');
    if (!body.name?.trim()) throwVbenError('命令名称不能为空');
    await this.assertPluginOperation(pluginKey, operationKey);

    return {
      aliases: this.stringifyList(body.aliases),
      code,
      cooldownMs: Math.max(
        Number(body.cooldownMs ?? this.getMinCooldownMs()),
        this.getMinCooldownMs(),
      ),
      defaultParams: this.stringifyParams(body.defaultParams),
      enabled: body.enabled ?? true,
      errorTemplate: body.errorTemplate || null,
      name: body.name.trim(),
      operationKey,
      parserKey: (body.parserKey || 'plain') as QqbotCommandParserType,
      pluginKey,
      prefixes: this.stringifyList(body.prefixes, ['/', '!', '！']),
      priority: Number(body.priority || 0),
      remark: body.remark || '',
      replyTemplate: body.replyTemplate || null,
      targetType: (body.targetType || 'all') as QqbotRuleTargetType,
    } as Partial<QqbotCommand>;
  }

  /**
   * 校验`code`、`currentId`是否满足代码Available约束，并拒绝不合法输入；从 `commandRepository.findOne` 读取代码Available。
   * @param code - 决定代码Available内容、边界或目标的 `code` 值。
   * @param currentId - 用于精确定位`current` 对应结果的标识；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  private async assertCodeAvailable(code: string, currentId?: string) {
    const where = (() => {
      if (currentId) {
        return { code, id: Not(currentId), isDeleted: false };
      }
      return { code, isDeleted: false };
    })();
    const existed = await this.commandRepository.findOne({ where });
    if (existed) throwVbenError(`命令编码已存在：${code}`);
  }

  /**
   * 校验`pluginKey`、`operationKey`是否满足插件操作约束，并拒绝不合法输入；从 `pluginExecution.getOperationByCommand` 读取插件操作。
   * @param pluginKey - 用于读取或更新插件操作的稳定键；为空时采用 `!operationKey` 作为兜底。
   * @param operationKey - 用于读取或更新插件操作的稳定键；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   */
  private async assertPluginOperation(
    pluginKey?: string,
    operationKey?: string,
  ) {
    if (!pluginKey || !operationKey) {
      throwVbenError('请选择插件和插件能力');
    }
    const operation = await this.pluginExecution.getOperationByCommand({
      operationKey,
      pluginKey,
    });
    if (!operation) {
      throwVbenError(`QQBot 插件能力不存在：${pluginKey}.${operationKey}`);
    }
  }

  /**
   * 通过 `filter` 筛选匹配数据。
   * @param value - 参与stringify比较、格式化或输出的候选值。
   * @param fallback - 主值缺失、为空或不合法时采用的兜底结果；省略时默认采用 `[]`。
   * @returns 去除空项并按首次出现顺序去重后的 JSON 数组文本；没有有效项时序列化兜底列表。
   */
  private stringifyList(value: string[] | string | undefined, fallback = []) {
    const list = (() => {
      if (Array.isArray(value)) {
        return value;
      }
      return `${value || ''}`.split(',').map((item) => item.trim());
    })();
    const normalized = list
      .map((item) => `${item || ''}`.trim())
      .filter(Boolean);
    return JSON.stringify([
      ...new Set(
        (() => {
          if (normalized.length > 0) {
            return normalized;
          }
          return fallback;
        })(),
      ),
    ]);
  }

  /**
   * 从`value`解析`parseList` 对应结果；当 `source.startsWith('[')` 成立时返回 `parsed`。
   * @param value - 待转换为`parseList` 对应结果的原始值。
   * @returns `parseList` 对应。
   */
  private parseList(value: string | null | undefined) {
    const source = `${value || ''}`.trim();
    if (!source) return [];
    if (source.startsWith('[')) {
      try {
        const parsed = JSON.parse(source);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        return [];
      } catch {
        return [];
      }
    }
    return source
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  /**
   * 将`value`转换为stringify参数；当 `typeof value === 'string'` 成立时返回 `null`。
   * @param value - 参与stringify参数比较、格式化或输出的候选值。
   * @returns stringify参数；无法解析或未命中时为 `null`。
   */
  private stringifyParams(value: any) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'string') {
      const source = value.trim();
      if (!source) return null;
      this.parseJson(source);
      return source;
    }
    return JSON.stringify(value);
  }

  /**
   * 将默认参数文本解析为 JSON；空值回退为空对象，格式非法时拒绝保存。
   * @param value - 待转换为JSON 数据的原始值。
   * @returns JSON 数据。
   */
  private parseJson(value: string | null | undefined) {
    if (!value) return {};
    try {
      return JSON.parse(value);
    } catch {
      throwVbenError('默认参数必须是合法 JSON');
    }
  }

  /**
   * 通过 `JSON.stringify` 生成稳定文本。
   * @param output - 用于stringify持久化Output的领域对象，包含 `replyText` 字段。
   * @returns stringify持久化Output。
   */
  private stringifyStoredOutput(output: any) {
    if (
      output &&
      typeof output === 'object' &&
      !Array.isArray(output) &&
      typeof output.replyText === 'string'
    ) {
      return JSON.stringify({
        ...output,
        replyText: this.toolsService.toStoredMessageText(output.replyText),
      });
    }
    return JSON.stringify(output);
  }

  /**
   * 将`command`转换为Raw请求内容。
   * @param command - 用于Raw请求内容的领域对象，包含 `aliases`、`code`、`cooldownMs`、`enabled` 字段。
   * @returns 包含 `aliases`、`code`、`cooldownMs`、`defaultParams`、`enabled` 字段的Raw请求内容。
   */
  private toRawBody(command: QqbotCommand): QqbotCommandBodyDto {
    return {
      aliases: this.parseList(command.aliases),
      code: command.code,
      cooldownMs: command.cooldownMs,
      defaultParams: this.parseDefaultParams(command),
      enabled: command.enabled,
      errorTemplate: command.errorTemplate || '',
      name: command.name,
      operationKey: command.operationKey,
      parserKey: command.parserKey,
      pluginKey: command.pluginKey,
      prefixes: this.parseList(command.prefixes),
      priority: command.priority,
      remark: command.remark,
      replyTemplate: command.replyTemplate || '',
      targetType: command.targetType,
    };
  }

  /**
   * 按当前运行态读取Min冷却时间Ms；当 `Number.isInteger(value) && value > 0` 成立时返回 `value`。
   * @returns 当前状态对应的Min冷却时间Ms，取值为 `5000`。
   */
  private getMinCooldownMs() {
    const value = Number(
      this.configService.get('QQBOT_COMMAND_MIN_COOLDOWN_MS'),
    );
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
    return 5000;
  }
}
