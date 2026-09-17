import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { withDatabaseLock } from '@/common/locks/database-lock';
import { DataSource, In } from 'typeorm';
import { createSnowflakeId } from '@/common/snowflake/snowflake-id';
import { validateDataValues } from '@/common/automation/data-schema';
import {
  definitionRecord,
  publishedReference,
  type PublishedReference,
} from '@/common/automation/definition.types';
import { validateDefinitionInput } from '@/common/automation/definition.repository';
import type { AtomicRunView } from '../contract/task-definition.types';
import type {
  TaskExecutionPort,
  TaskExecutionRequest,
} from '../contract/task-execution.port';
import {
  AtomicTaskAttempt,
  AtomicTaskRun,
  AtomicTaskRunReview,
} from '../infrastructure/persistence/task-execution.entities';
import { TaskDefinitionService } from './task-definition.service';

@Injectable()
export class TaskExecutionService implements TaskExecutionPort {
  private readonly logger = new Logger(TaskExecutionService.name);
  constructor(
    private readonly database: DataSource,
    private readonly tasks: TaskDefinitionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 从任务模块自己的发布记录解析执行能力，不查询调度计划或插件表。
   * @param reference - 原子任务固定版本。
   * @returns 固定数据契约及实时可用性。
   */
  resolve(reference: PublishedReference) {
    return this.tasks.resolve(reference);
  }

  /**
   * 校验输入并先持久化待执行身份，相同请求键只返回同一运行。
   * @param request - 固定任务版本、输入、父关联与总期限。
   * @returns 已持久化的运行状态。
   * @throws 请求键复用为不同内容、版本不可用或输入非法时拒绝派发。
   */
  async start(request: TaskExecutionRequest): Promise<AtomicRunView> {
    validateDefinitionInput(() => definitionRecord(request));
    if (!request.parentRunId || !request.nodeId)
      throw new BadRequestException('内置动作只能由工作流活动发起');
    const reference = validateDefinitionInput(() =>
      publishedReference(request.taskRef),
    );
    if (
      typeof request.executionKey !== 'string' ||
      !request.executionKey.trim() ||
      request.executionKey.length > 191
    )
      throw new BadRequestException('必须提供 1 至 191 字符的执行请求键');
    if (
      !Number.isSafeInteger(request.deadlineAt) ||
      request.deadlineAt > Date.now() + 31 * 86400000
    )
      throw new BadRequestException('执行总期限不合法');
    if (
      request.parentRunId !== undefined &&
      !/^[1-9]\d{0,19}$/.test(request.parentRunId)
    )
      throw new BadRequestException('父运行身份不合法');
    if (
      request.nodeId !== undefined &&
      !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(request.nodeId)
    )
      throw new BadRequestException('节点身份不合法');
    const definition = await this.tasks.definitions.published(reference);
    const input = validateDefinitionInput(() =>
      validateDataValues(definition.contract.inputSchema, request.input),
    );
    const executionKey = createHash('sha256')
      .update(request.executionKey)
      .digest('hex');
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          reference,
          Object.entries(input).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
          request.parentRunId || null,
          request.nodeId || null,
          request.deadlineAt,
        ]),
      )
      .digest('hex');
    const repository = this.database.getRepository(AtomicTaskRun);
    const existing = await repository.findOneBy({ executionKey });
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new ConflictException('执行请求键已经用于其他内容');
      return this.view(existing);
    }
    if (request.deadlineAt <= Date.now())
      throw new BadRequestException('执行期限已经结束');
    await this.tasks.checkForPublish(definition);
    const run = repository.create({
      id: createSnowflakeId(),
      taskId: reference.id,
      taskVersion: reference.version,
      executionKey,
      requestHash,
      parentRunId: request.parentRunId || null,
      nodeId: request.nodeId || null,
      status: 'pending',
      inputValues: input,
      outputValues: null,
      attemptCount: 0,
      cancelRequested: false,
      requiresReview: false,
      errorMessage: null,
      deadlineAt: new Date(request.deadlineAt),
      nextAttemptAt: new Date(),
      finishedAt: null,
    });
    try {
      await repository.insert(run);
    } catch (error) {
      const duplicate = await repository.findOneBy({ executionKey });
      if (!duplicate) throw error;
      if (duplicate.requestHash !== requestHash)
        throw new ConflictException('执行请求键已经用于其他内容');
      return this.view(duplicate);
    }
    return this.view(run);
  }

  /**
   * 返回运行公开状态及声明过的输出，不向消费者暴露输入或内部处理器错误。
   * @param runId - 原子运行标识。
   * @returns 持久运行状态。
   * @throws 运行不存在时返回 HTTP 404。
   */
  async read(runId: string): Promise<AtomicRunView> {
    const run = await this.database
      .getRepository(AtomicTaskRun)
      .findOneBy({ id: runId });
    if (!run) throw new NotFoundException('任务运行不存在');
    return this.view(run);
  }

  /**
   * 向任务管理页提供尝试身份、发布版本和不可变人工核对记录，不暴露原始输入。
   * @param runId - 任务运行身份。
   * @returns 公开运行状态、按顺序排列的尝试和已提交的核对说明。
   */
  async details(runId: string) {
    const run = await this.read(runId);
    const attempts = await this.database
      .getRepository(AtomicTaskAttempt)
      .find({ where: { runId }, order: { attemptNo: 'ASC' } });
    const review = await this.database
      .getRepository(AtomicTaskRunReview)
      .findOneBy({ runId });
    return { ...run, attempts, review };
  }

  /**
   * 持有同一任务执行锁后封存操作人的业务核对结论，仅解除后续运行阻塞，不重放或改写原失败结果。
   * @param runId - 结果未知的终态运行身份。
   * @param actorId - JWT 绑定的管理员身份，禁止使用请求正文中的操作人。
   * @param body - 已核实的副作用分类和可追溯业务证据说明。
   * @returns 原始失败状态和新核对记录；相同操作人重复提交同一结论返回已有记录。
   * @throws 缺少核对证据、任务仍执行中、已有不同核对或状态不匹配时拒绝解除阻塞。
   */
  async review(runId: string, actorId: string, body: unknown) {
    const input = validateDefinitionInput(() => definitionRecord(body));
    if (!/^[1-9]\d{0,19}$/.test(String(actorId)))
      throw new BadRequestException('核对操作人身份不合法');
    if (
      !['effect-confirmed', 'no-effect', 'compensated'].includes(
        String(input.resolution),
      ) ||
      Object.keys(input).some((key) => !['resolution', 'reason'].includes(key))
    )
      throw new BadRequestException('核对结论或请求字段不合法');
    if (
      typeof input.reason !== 'string' ||
      !input.reason.trim() ||
      input.reason.trim().length > 2048
    )
      throw new BadRequestException('请填写核对结论与业务证据说明');
    const resolution = input.resolution as AtomicTaskRunReview['resolution'];
    const reason = input.reason.trim();
    const snapshot = await this.read(runId);
    const lock = `kt:task:${snapshot.taskId}`;
    const result = await withDatabaseLock(
      this.database,
      lock,
      0,
      (connection) =>
        connection.transaction(async (manager) => {
          const existing = await manager.findOneBy(AtomicTaskRunReview, {
            runId,
          });
          if (existing) {
            if (
              existing.reviewedBy !== actorId ||
              existing.resolution !== resolution ||
              existing.reason !== reason
            )
              throw new ConflictException('此运行已有不同核对记录，不能覆盖');
          } else {
            const run = await manager.findOneBy(AtomicTaskRun, { id: runId });
            if (!run || run.status !== 'failed' || !run.requiresReview)
              throw new ConflictException('仅允许核对结果未知的失败运行');
            await manager.insert(AtomicTaskRunReview, {
              runId,
              reviewedBy: actorId,
              resolution,
              reason,
            });
            await manager.update(
              AtomicTaskRun,
              { id: runId },
              { requiresReview: false },
            );
          }
        }),
    );
    if (!result.acquired)
      throw new ConflictException('该任务仍有处理器执行，请等待退出后核对');
    return this.details(runId);
  }

  /**
   * 请求取消当前运行，执行中的处理器收到信号后仍保留数据库锁直到退出。
   * @param runId - 待取消的原子运行。
   * @returns 持久化取消意图后的运行状态。
   */
  async cancel(runId: string): Promise<AtomicRunView> {
    await this.database
      .getRepository(AtomicTaskRun)
      .update(
        { id: runId, status: In(['pending', 'running']) },
        { cancelRequested: true },
      );
    return this.read(runId);
  }

  /**
   * 取消父流程下全部在途原子运行，覆盖节点关联尚未回写时的中断窗口。
   * @param parentRunId - 发起原子任务时绑定的父流程运行身份。
   * @returns 仍有处理器或待处理取消请求时标记为活动。
   */
  async cancelParent(parentRunId: string): Promise<{ active: boolean }> {
    const repository = this.database.getRepository(AtomicTaskRun);
    const where = { parentRunId, status: In(['pending', 'running']) };
    await repository.update(where, { cancelRequested: true });
    return { active: await repository.existsBy(where) };
  }

  /**
   * 在与原任务锁互通的独占连接内推进一次运行，崩溃遗留的副作用不会自动重放。
   * @param runId - 已落盘的运行标识。
   * @param canExecute - 工作流对父实例和活动令牌的持续授权检查。
   * @throws 无法持久化执行状态时让队列保留失败证据。
   */
  async process(
    runId: string,
    canExecute: () => Promise<boolean>,
  ): Promise<void> {
    const repository = this.database.getRepository(AtomicTaskRun);
    const snapshot = await repository.findOneBy({ id: runId });
    if (!snapshot || !['pending', 'running'].includes(snapshot.status)) return;
    const lock = `kt:task:${snapshot.taskId}`;
    await withDatabaseLock(this.database, lock, 0, async (_manager, lease) => {
      const run = await repository.findOneBy({ id: runId });
      if (!run || !['pending', 'running'].includes(run.status)) return;
      if (run.status === 'running') {
        await this.failInterrupted(run);
        return;
      }
      if (run.cancelRequested || !(await canExecute())) {
        await repository.update(
          { id: run.id },
          { status: 'cancelled', finishedAt: new Date() },
        );
        return;
      }
      if (Date.now() >= new Date(run.deadlineAt).getTime()) {
        await repository.update(
          { id: run.id },
          {
            status: 'failed',
            errorMessage: '执行总期限已结束',
            finishedAt: new Date(),
          },
        );
        return;
      }
      if (new Date(run.nextAttemptAt).getTime() > Date.now()) return;
      const uncertain = await repository.findOneBy({
        taskId: run.taskId,
        requiresReview: true,
      });
      if (uncertain) {
        await repository.update(
          { id: run.id },
          {
            status: 'failed',
            errorMessage: `存在结果未知的运行 ${uncertain.id}，请先核查副作用`,
            finishedAt: new Date(),
          },
        );
        return;
      }
      await this.executeAttempt(run, async () => {
        const owned = await lease.isOwned();
        if (!(await canExecute()))
          await repository.update({ id: run.id }, { cancelRequested: true });
        return owned;
      });
    });
  }

  /**
   * 将失去执行连接但仍处于运行中的记录终结为未知失败，保留独立尝试历史。
   * @param run - 已确认没有活跃锁所有者的运行。
   */
  private async failInterrupted(run: AtomicTaskRun): Promise<void> {
    const errorMessage = '执行进程中断，副作用结果未知；未自动重放';
    await this.database.transaction(async (manager) => {
      await manager.update(
        AtomicTaskAttempt,
        { runId: run.id, status: 'running' },
        { status: 'failed', errorMessage, finishedAt: new Date() },
      );
      await manager.update(
        AtomicTaskRun,
        { id: run.id },
        {
          status: 'failed',
          requiresReview: true,
          errorMessage,
          finishedAt: new Date(),
        },
      );
    });
  }

  /**
   * 写入尝试身份后调用固定版本处理器，只持久化契约声明的输出并实施幂等重试。
   * @param run - 持有任务独占锁的待运行记录。
   * @param ownsLock - 在执行中验证原独占连接仍然有效的检查。
   */
  private async executeAttempt(
    run: AtomicTaskRun,
    ownsLock: () => Promise<boolean>,
  ): Promise<void> {
    const runs = this.database.getRepository(AtomicTaskRun);
    const definition = await this.tasks.definitions.published({
      id: run.taskId,
      version: run.taskVersion,
    });
    const handler = this.tasks.handlers.resolve(definition.handler);
    if (
      !handler ||
      !this.tasks.matchesContract(definition) ||
      !(await handler.isAvailable())
    ) {
      await runs.update(
        { id: run.id },
        {
          status: 'failed',
          errorMessage: '处理器版本未加载、契约变化或已停用',
          finishedAt: new Date(),
        },
      );
      return;
    }
    const attempt = this.database.getRepository(AtomicTaskAttempt).create({
      id: createSnowflakeId(),
      runId: run.id,
      attemptNo: run.attemptCount + 1,
      status: 'running',
      handlerKey: handler.key,
      handlerVersion: handler.version,
      runtimeIdentity: String(
        this.config.get('RELEASE_ID') ||
          this.config.get('IMAGE_TAG') ||
          this.config.get('GIT_COMMIT') ||
          'local-unversioned',
      ).slice(0, 191),
      startedAt: new Date(),
      finishedAt: null,
      errorMessage: null,
    });
    await this.database.transaction(async (manager) => {
      await manager.insert(AtomicTaskAttempt, attempt);
      await manager.update(
        AtomicTaskRun,
        { id: run.id },
        { status: 'running', attemptCount: attempt.attemptNo },
      );
    });
    const controller = new AbortController();
    let controlFailure = false;
    let cancellation = false;
    let controlCheck: Promise<void> | undefined;
    const timeoutMs = Math.min(
      definition.timeoutMs,
      handler.timeoutMs,
      new Date(run.deadlineAt).getTime() - Date.now(),
    );
    const deadline = setTimeout(
      () => controller.abort(),
      Math.max(1, timeoutMs),
    );
    const checkControl = (): Promise<void> => {
      if (controlCheck) return controlCheck;
      controlCheck = (async () => {
        try {
          const current = await runs.findOneBy({ id: run.id });
          if (!current || !(await ownsLock())) {
            controlFailure = true;
            controller.abort();
          } else if (
            current.cancelRequested ||
            (await runs.findOneBy({ id: run.id }))?.cancelRequested
          ) {
            cancellation = true;
            controller.abort();
          }
        } catch {
          controlFailure = true;
          controller.abort();
        } finally {
          controlCheck = undefined;
        }
      })();
      return controlCheck;
    };
    const control = setInterval(() => void checkControl(), 500);
    try {
      await checkControl();
      let output: Record<string, unknown> = {};
      let status: AtomicTaskRun['status'] = 'succeeded';
      let errorMessage: string | null = null;
      if (!controller.signal.aborted) {
        try {
          const result = await handler.execute({
            input: run.inputValues,
            runId: run.id,
            attemptId: attempt.id,
            executionKey: run.executionKey,
            signal: controller.signal,
          });
          output = validateDataValues(
            definition.contract.outputSchema,
            result ?? {},
          );
        } catch {
          status = 'failed';
          errorMessage =
            '处理器执行或输出契约校验失败；请按尝试 ID 查询领域日志';
          this.logger.warn(`原子任务 ${run.id} 尝试 ${attempt.id} 失败`);
        }
      }
      await checkControl();
      if (
        controller.signal.aborted ||
        Date.now() >= new Date(run.deadlineAt).getTime()
      ) {
        status = 'failed';
        errorMessage = '执行超过期限，处理器已退出';
      }
      if (cancellation) {
        status = 'cancelled';
        errorMessage = null;
      }
      if (controlFailure) {
        status = 'failed';
        errorMessage = '执行锁或取消状态无法确认，结果需要核查';
      }
      const attemptStatus = status;
      let finishedAt: Date | null = new Date();
      const nextAttemptAt = new Date(Date.now() + definition.retryBackoffMs);
      if (
        status === 'failed' &&
        !controller.signal.aborted &&
        handler.idempotent &&
        attempt.attemptNo < definition.maxAttempts &&
        nextAttemptAt.getTime() < new Date(run.deadlineAt).getTime()
      ) {
        status = 'pending';
        finishedAt = null;
      }
      let outputValues: Record<string, unknown> | null = null;
      if (status === 'succeeded') outputValues = output;
      await this.database.transaction(async (manager) => {
        await manager.update(
          AtomicTaskAttempt,
          { id: attempt.id },
          { status: attemptStatus, errorMessage, finishedAt: new Date() },
        );
        await manager.update(
          AtomicTaskRun,
          { id: run.id },
          {
            status,
            requiresReview: controlFailure,
            errorMessage,
            outputValues,
            nextAttemptAt,
            finishedAt,
          },
        );
      });
    } finally {
      clearTimeout(deadline);
      clearInterval(control);
      await controlCheck;
    }
  }

  /**
   * 收敛公开运行结果，输出只来自成功尝试的声明字段。
   * @param run - 持久化运行记录。
   * @returns 供工作流、计划和页面读取的状态契约。
   */
  private view(run: AtomicTaskRun): AtomicRunView {
    return {
      runId: run.id,
      taskId: run.taskId,
      taskVersion: run.taskVersion,
      status: run.status,
      output: run.outputValues || {},
      error: run.errorMessage,
      requiresReview: run.requiresReview,
    };
  }
}
