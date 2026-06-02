import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { QqbotPluginRegistryService } from '../plugin/qqbot-plugin-registry.service';
import type {
  QqbotCommandParserType,
  QqbotNormalizedMessage,
  QqbotRuleTargetType,
} from '../qqbot.types';
import { getPageParams, normalizeBoolean } from '../qqbot.utils';
import type {
  QqbotCommandBodyDto,
  QqbotCommandQueryDto,
  QqbotCommandUpdateDto,
} from './qqbot-command.dto';
import { QqbotCommandLog } from './qqbot-command-log.entity';
import { QqbotCommand } from './qqbot-command.entity';

@Injectable()
export class QqbotCommandService {
  constructor(
    @InjectRepository(QqbotCommand)
    private readonly commandRepository: Repository<QqbotCommand>,
    @InjectRepository(QqbotCommandLog)
    private readonly commandLogRepository: Repository<QqbotCommandLog>,
    private readonly pluginRegistry: QqbotPluginRegistryService,
  ) {}

  async page(query: QqbotCommandQueryDto) {
    const { pageNo, pageSize, skip } = getPageParams(query);
    const builder = this.commandRepository
      .createQueryBuilder('command')
      .where('command.isDeleted = :isDeleted', { isDeleted: false });

    if (query.keyword) {
      builder.andWhere(
        '(command.code LIKE :keyword OR command.name LIKE :keyword OR command.aliases LIKE :keyword)',
        { keyword: `%${query.keyword}%` },
      );
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
        enabled: normalizeBoolean(query.enabled),
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

  async listEnabledForMessage(message: QqbotNormalizedMessage) {
    return this.commandRepository
      .createQueryBuilder('command')
      .where('command.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('command.enabled = :enabled', { enabled: true })
      .andWhere('command.targetType IN (:...targetTypes)', {
        targetTypes: ['all', message.messageType],
      })
      .orderBy('command.priority', 'DESC')
      .addOrderBy('command.createTime', 'ASC')
      .getMany();
  }

  async findById(id: string) {
    const command = await this.commandRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!command) throwVbenError('命令不存在');
    return command;
  }

  async save(body: QqbotCommandBodyDto) {
    const payload = await this.normalizeBody(body);
    await this.assertCodeAvailable(payload.code);
    const saved = await this.commandRepository.save(
      this.commandRepository.create(payload),
    );
    return saved.id;
  }

  async update(body: QqbotCommandUpdateDto) {
    const current = await this.findById(body.id);
    const payload = await this.normalizeBody({
      ...this.toRawBody(current),
      ...body,
    });
    await this.assertCodeAvailable(payload.code, body.id);
    await this.commandRepository.update({ id: body.id }, payload);
    return true;
  }

  async remove(id: string) {
    await this.commandRepository.update({ id }, { isDeleted: true });
    return true;
  }

  async toggle(id: string, enabled: boolean) {
    await this.commandRepository.update({ id }, { enabled });
    return true;
  }

  async markHit(command: QqbotCommand) {
    await this.commandRepository.update(
      { id: command.id },
      { lastHitAt: new Date() },
    );
  }

  isInCooldown(command: QqbotCommand) {
    if (!command.lastHitAt || !command.cooldownMs) return false;
    return (
      Date.now() - new Date(command.lastHitAt).getTime() < command.cooldownMs
    );
  }

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
        output:
          params.output === undefined ? null : JSON.stringify(params.output),
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

  parseDefaultParams(command: QqbotCommand) {
    return this.parseJson(command.defaultParams);
  }

  toResponse(command: QqbotCommand) {
    return {
      ...command,
      aliases: this.parseList(command.aliases),
      defaultParams: this.parseDefaultParams(command),
      prefixes: this.parseList(command.prefixes),
    };
  }

  private async normalizeBody(body: QqbotCommandBodyDto) {
    const code = `${body.code || ''}`.trim();
    const pluginKey = `${body.pluginKey || ''}`.trim();
    const operationKey = `${body.operationKey || ''}`.trim();
    if (!code) throwVbenError('命令编码不能为空');
    if (!body.name?.trim()) throwVbenError('命令名称不能为空');
    this.pluginRegistry.assertOperation(pluginKey, operationKey);

    return {
      aliases: this.stringifyList(body.aliases),
      code,
      cooldownMs: Number(body.cooldownMs ?? 1500),
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

  private async assertCodeAvailable(code: string, currentId?: string) {
    const where = currentId
      ? { code, id: Not(currentId), isDeleted: false }
      : { code, isDeleted: false };
    const existed = await this.commandRepository.findOne({ where });
    if (existed) throwVbenError(`命令编码已存在：${code}`);
  }

  private stringifyList(value: string[] | string | undefined, fallback = []) {
    const list = Array.isArray(value)
      ? value
      : `${value || ''}`
          .split(',')
          .map((item) => item.trim());
    const normalized = list
      .map((item) => `${item || ''}`.trim())
      .filter(Boolean);
    return JSON.stringify([
      ...new Set(normalized.length > 0 ? normalized : fallback),
    ]);
  }

  private parseList(value: string | null | undefined) {
    const source = `${value || ''}`.trim();
    if (!source) return [];
    if (source.startsWith('[')) {
      try {
        const parsed = JSON.parse(source);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return source
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

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

  private parseJson(value: string | null | undefined) {
    if (!value) return {};
    try {
      return JSON.parse(value);
    } catch {
      throwVbenError('默认参数必须是合法 JSON');
    }
  }

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
}
