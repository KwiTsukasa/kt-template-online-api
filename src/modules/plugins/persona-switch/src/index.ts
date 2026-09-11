import { randomUUID } from 'node:crypto';
import type {
  PluginStateSnapshot,
  PluginStateWrite,
} from '@/modules/plugin-platform/contract/plugin-state';
import { synchronizeSoul, type RequestResponse } from './hermes-soul';
import { parsePersonaCommand, PERSONA_HELP } from './command';
import {
  callProfileExecutor,
  readProfileResult,
  isOfficialBotSelfId,
} from './profile-client';
import {
  readState,
  savePersona,
  type Persona,
  type PersonaState,
} from './state';

type Options = {
  host: Record<string, unknown>;
  manifest: {
    pluginKey: string;
    name: string;
    version: string;
    description?: string;
    operations: Array<{ key: string; handlerName: string; name: string }>;
  };
  runtime: { configSnapshot: Record<string, string | undefined> };
};

/**
 * 将显式图文命令与未完成任务恢复交给同一 API 状态机，普通聊天不修改人格。
 * @param options - 插件身份、私有配置与受控宿主能力。
 * @returns 通用插件工作线程可加载的管理实例。
 * @throws 清单引用未实现操作时拒绝加载。
 */
export function createPlugin(options: Options) {
  const application = new PersonaApplication(options);
  return {
    key: options.manifest.pluginKey,
    name: options.manifest.name,
    version: options.manifest.version,
    description: options.manifest.description,
    activate: () => application.restore(true),
    tasks: [{ key: 'persona.reconcile', execute: () => application.restore() }],
    operations: options.manifest.operations.map((operation) => {
      if (operation.handlerName !== 'managePersona')
        throw new Error('人格操作未实现');
      return {
        ...operation,
        execute: (
          input: Record<string, unknown>,
          context?: Record<string, unknown>,
        ) => application.manage(input, context),
      };
    }),
  };
}

class PersonaApplication {
  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  /**
   * 读取并校验本插件的持久快照，不向请求方提供其他插件数据。
   * @returns 独立状态副本及其乐观并发版本。
   * @throws 状态能力缺失或版本损坏时停止操作。
   */
  private async read() {
    const read = this.options.host.readPluginState;
    if (typeof read !== 'function') throw new Error('人格状态存储未就绪。');
    const snapshot = (await read()) as PluginStateSnapshot;
    if (
      !snapshot ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0
    )
      throw new Error('人格状态版本无效。');
    return { revision: snapshot.revision, state: readState(snapshot.value) };
  }

  /**
   * 条件保存 API 状态，阻止多个线程覆盖同一共享人格选择。
   * @param revision - 本轮读取的预期版本。
   * @param state - 待保存的完整人格状态。
   * @returns 持久化后的新版本号。
   * @throws 缺少条件写能力或并发冲突时拒绝确认。
   */
  private async write(revision: number, state: PersonaState) {
    const write = this.options.host.compareAndSwapPluginState;
    if (typeof write !== 'function') throw new Error('人格状态存储未就绪。');
    const snapshot = (await write({
      expectedRevision: revision,
      value: state,
    } satisfies PluginStateWrite)) as PluginStateSnapshot;
    return snapshot.revision;
  }

  /**
   * 取得由宿主限制大小和超时的 HTTP 通道。
   * @returns 已绑定插件身份的请求能力。
   * @throws 网络能力尚未接线时停止外部操作。
   */
  private request(): RequestResponse {
    const request = this.options.host.requestResponse;
    if (typeof request !== 'function') throw new Error('人格同步通道未就绪。');
    return request as RequestResponse;
  }

  /**
   * 下载第一张 QQ 附件并持久存入 NAS，只有得到内容摘要才允许保存人格。
   * @param imageUrl - 由宿主真实附件投影取得的第一张图片地址。
   * @returns NAS 已验证并保存的头像内容标识。
   * @throws 非 QQ 图片域、下载或持久化失败时不保存人格。
   */
  private async saveAvatar(imageUrl: string) {
    const url = new URL(imageUrl);
    if (
      url.hostname !== 'multimedia.nt.qq.com' &&
      url.hostname !== 'multimedia.nt.qq.com.cn' &&
      !url.hostname.endsWith('.qpic.cn')
    )
      throw new Error('头像必须来自本条 QQ 图片附件。');
    const downloaded = await this.request()({
      url: imageUrl,
      method: 'GET',
      timeoutMs: 8000,
      maxResponseBytes: 2 * 1024 * 1024,
      context: '人格头像读取',
    });
    if (downloaded.statusCode !== 200) throw new Error('头像读取失败。');
    const saved = await callProfileExecutor(
      this.options.runtime.configSnapshot,
      this.request(),
      '/v1/avatars',
      { image: Buffer.from(downloaded.body).toString('base64') },
    );
    if (typeof saved.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(saved.hash))
      throw new Error('头像持久化未确认。');
    return { hash: saved.hash };
  }

  /**
   * 持久化唯一切换目标，读回 SOUL 后确认选择并登记 NAS 资料同步任务。
   * @param revision - 准备竞争的 API 版本。
   * @param state - 当前目录及最后确认状态。
   * @param target - 本轮唯一允许同步的人格版本。
   * @param botSelfId - 原命令绑定的官方账号，恢复时只能沿用已持久化的身份。
   * @returns 已确认人格和后台资料任务的最新状态。
   */
  private async synchronize(
    revision: number,
    state: PersonaState,
    target: Persona,
    botSelfId?: string,
  ) {
    const jobId = state.pending?.jobId ?? randomUUID();
    const pending = {
      ...state,
      pending: {
        target: structuredClone(target),
        retryAfter: Date.now() + 60_000,
        jobId,
        botSelfId,
      },
    };
    const acquired = await this.write(revision, pending);
    await synchronizeSoul(
      this.options.runtime.configSnapshot,
      this.request(),
      target.content,
    );
    let previous = state.previous;
    if (JSON.stringify(state.current) !== JSON.stringify(target))
      previous = structuredClone(state.current);
    const next: PersonaState = {
      ...state,
      current: structuredClone(target),
      previous,
      pending: null,
    };
    if (target.avatar)
      next.botProfile = {
        id: jobId,
        botSelfId,
        target: structuredClone(target),
        status: 'queued',
        detail: '等待 NAS 同步 Bot 昵称和头像。',
      };
    const confirmed = await this.write(acquired, next);
    return this.refreshProfile(confirmed, next);
  }

  /**
   * 使用持久操作身份提交或读取后台任务，重试不会建立另一份资料修改任务。
   * @param revision - 本轮人格快照版本。
   * @param state - 含待处理资料任务的状态。
   * @returns 已读取最新结果或仍等待执行器恢复的状态。
   */
  private async refreshProfile(
    revision: number,
    state: PersonaState,
  ): Promise<PersonaState> {
    const job = state.botProfile;
    if (
      job &&
      !job.botSelfId &&
      ['queued', 'running', 'uncertain'].includes(job.status)
    ) {
      const next: PersonaState = {
        ...state,
        botProfile: {
          ...job,
          status: 'failed',
          detail:
            '旧资料任务缺少 Bot 身份，请从目标官方 Bot 重新发送切换命令。',
        },
      };
      await this.write(revision, next);
      return next;
    }
    if (
      !job ||
      (!['queued', 'running', 'uncertain'].includes(job.status) &&
        !(job.status === 'applied' && !job.verifiedBy))
    )
      return state;
    try {
      let response: Record<string, unknown>;
      if (job.status === 'queued')
        response = await callProfileExecutor(
          this.options.runtime.configSnapshot,
          this.request(),
          '/v1/jobs',
          {
            id: job.id,
            botSelfId: job.botSelfId,
            name: job.target.name,
            avatarHash: job.target.avatar?.hash,
          },
        );
      else
        response = await callProfileExecutor(
          this.options.runtime.configSnapshot,
          this.request(),
          '/v1/jobs/' + job.id,
        );
      const result = readProfileResult(response, job.id, job.botSelfId);
      const next = { ...state, botProfile: { ...job, ...result } };
      await this.write(revision, next);
      return next;
    } catch {
      return state;
    }
  }

  /**
   * 恢复未完成切换和资料任务；启动时核对当前 SOUL，保留会话及共享记忆。
   * @param startup - 是否同时核对最后确认的 SOUL。
   * @returns 是否完成本轮恢复检查。
   */
  async restore(startup = false) {
    try {
      const { revision, state } = await this.read();
      if (revision === 0) return { synchronized: false };
      if (state.pending) {
        if (state.pending.retryAfter > Date.now())
          return { synchronized: false };
        await this.synchronize(
          revision,
          state,
          state.pending.target,
          state.pending.botSelfId,
        );
      } else {
        if (startup)
          await synchronizeSoul(
            this.options.runtime.configSnapshot,
            this.request(),
            state.current.content,
          );
        await this.refreshProfile(revision, state);
      }
      return { synchronized: true };
    } catch {
      return { synchronized: false };
    }
  }

  /**
   * 按严格图文格式保存、切换或删除人格，返回说明及真实的独立同步状态。
   * @param input - 宿主剥离命令名后保留换行的原文与图片附件。
   * @param context - 与聊天参数分离的宿主执行上下文。
   * @returns 经现有 Bot 回复队列发送的中文文本，不回显头像地址或人格正文。
   */
  async manage(
    input: Record<string, unknown>,
    context?: Record<string, unknown>,
  ) {
    const command = parsePersonaCommand(input);
    if (!command) return { replyText: PERSONA_HELP };
    try {
      const { revision, state } = await this.read();
      if (command.action === 'help') {
        const latest = await this.refreshProfile(revision, state);
        const names =
          latest.profiles
            .filter((item) => item.avatar)
            .map((item) => item.name)
            .join('、') || '暂无';
        let text =
          PERSONA_HELP +
          '\n\n已保存：' +
          names +
          '\n当前人格：' +
          latest.current.name;
        if (latest.pending)
          text += '\n人格待同步：' + latest.pending.target.name;
        if (latest.botProfile)
          text += '\nBot 资料：' + latest.botProfile.detail;
        return { replyText: text };
      }
      if (state.pending)
        return { replyText: '上次人格切换尚待核验，请稍后查看 /persona h。' };
      if (command.action === 'save') {
        const avatar = await this.saveAvatar(command.imageUrl);
        await this.write(
          revision,
          savePersona(state, command.name, command.content, avatar),
        );
        return {
          replyText:
            '已保存 ' +
            command.name +
            ' 的正文与头像。使用 /persona c ' +
            command.name +
            ' 切换。',
        };
      }
      const target = state.profiles.find(
        (item) => item.name === command.name && item.avatar,
      );
      if (!target)
        return {
          replyText:
            '没有找到完整的人格：' + command.name + '。\n' + PERSONA_HELP,
        };
      if (command.action === 'delete') {
        if (
          state.current.name === target.name ||
          (state.botProfile?.target.name === target.name &&
            ['queued', 'running', 'uncertain'].includes(
              state.botProfile.status,
            ))
        )
          return {
            replyText: '该人格正在使用或同步，请先切换到其他人格后再删除。',
          };
        const next = {
          ...state,
          profiles: state.profiles.filter((item) => item.name !== target.name),
        };
        if (next.previous?.name === target.name) next.previous = null;
        await this.write(revision, next);
        return {
          replyText: '已删除人格：' + target.name + '。共享记忆与对话保留。',
        };
      }
      if (
        state.botProfile &&
        ['queued', 'running', 'uncertain'].includes(state.botProfile.status)
      ) {
        const latest = await this.refreshProfile(revision, state);
        return {
          replyText:
            '上次 Bot 资料同步：' +
            latest.botProfile?.detail +
            ' 请确认完成后再切换。',
        };
      }
      const bot = context?.bot as { selfId?: unknown } | undefined;
      if (!isOfficialBotSelfId(bot?.selfId))
        return {
          replyText:
            '缺少目标官方 Bot 身份，请直接向目标官方 Bot 发送切换命令。',
        };
      const next = await this.synchronize(revision, state, target, bot.selfId);
      return {
        replyText:
          '共享人格已选择：' +
          next.current.name +
          '。对话和记忆保留。\nBot 资料：' +
          (next.botProfile?.detail ?? '尚未提交') +
          '\n/persona h 可查看结果。',
      };
    } catch {
      if (command.action === 'save')
        return {
          replyText:
            '保存未成功，请检查图文格式及图片能否读取后重发。\n' + PERSONA_HELP,
        };
      return {
        replyText:
          '人格操作未确认成功，请用 /persona h 查看；系统会恢复原待同步目标。',
      };
    }
  }
}
