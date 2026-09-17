import { requireExecutionState } from '@/common/automation/validation';
import { automationDigest } from '@/common/automation/content-digest';
import {
  RUN_STATUS,
  RUN_STATUS_GROUP,
} from '@/common/automation/constants/run-status';
import { Injectable } from '@nestjs/common';
import { validateDataValues } from '@/common/automation/data-schema';
import type { WorkflowStepInvocation } from '../contract/workflow-process.interface';
import type {
  WorkflowScriptCall,
  WorkflowScriptBatchContext,
  WorkflowScriptResult,
} from '../contract/workflow-script.types';
import type { WorkflowActivityState } from '../contract/workflow-activity.types';
import { WorkflowScriptRunner } from '../infrastructure/workflow-script.runner';
import { WorkflowScriptRegistry } from './workflow-script.registry';

type ScriptBatch = {
  status:
    | typeof RUN_STATUS.waiting
    | typeof RUN_STATUS.failed
    | typeof RUN_STATUS.cancelled
    | typeof RUN_STATUS.succeeded;
  results: WorkflowScriptResult[];
};

@Injectable()
export class WorkflowScriptExecutionService {
  constructor(
    private readonly registry: WorkflowScriptRegistry,
    private readonly runner: WorkflowScriptRunner,
  ) {}

  /**
   * 按工作流声明顺序推进脚本，只在前一脚本有成功回执后启动下一脚本；未知副作用禁止重试。
   * @param calls - 节点保存的有序固定脚本与重试策略。
   * @param invocation - 工作流拥有的业务与步骤身份。
   * @param state - 节点拥有的密封准备参数及脚本尝试账本。
   * @param context - 已映射的脚本参数、业务接口和工作流持久化与停止端口。
   * @returns 当前脚本批次状态与已经证实的有序结果。
   * @throws 脚本契约、参数或回执身份不相容时拒绝继续派发。
   */
  async advance(
    calls: WorkflowScriptCall[],
    invocation: WorkflowStepInvocation,
    state: WorkflowActivityState,
    context: WorkflowScriptBatchContext,
  ): Promise<ScriptBatch> {
    requireExecutionState(
      calls.length && state.preparedInput,
      '步骤脚本或密封参数缺失',
    );
    const attempts = state.scriptAttempts || [];
    state.scriptAttempts = attempts;
    const results: WorkflowScriptResult[] = [];
    const latestAttempts = new Map(
      attempts.map((attempt) => [attempt.index, attempt]),
    );
    const refreshStop = async () => {
      if (!invocation.stopRequested)
        invocation.stopRequested = await context.control.shouldStop();
    };
    for (const [index, call] of calls.entries()) {
      await refreshStop();
      const script = this.registry.check(
        call,
        context.processKey,
        invocation.stepKey,
      );
      const params: Record<string, unknown> = { ...script.defaults };
      for (const field of script.paramsSchema.fields) {
        if (Object.hasOwn(state.preparedInput, field.key))
          params[field.key] = state.preparedInput[field.key];
      }
      for (const [key, value] of Object.entries(context.params[index])) {
        requireExecutionState(
          !Object.hasOwn(state.preparedInput, key),
          '脚本参数不能覆盖业务密封参数',
        );
        params[key] = value;
      }
      const validParams = validateDataValues(script.paramsSchema, params);
      let attempt = latestAttempts.get(index);
      if (attempt?.status === RUN_STATUS.succeeded) {
        results.push({
          executionId: attempt.executionId,
          script: attempt.script,
          status: RUN_STATUS.succeeded,
          exitCode: attempt.exitCode,
          output: attempt.output,
        });
        continue;
      }
      if (
        invocation.stopRequested &&
        (!attempt || RUN_STATUS_GROUP.unsuccessful.includes(attempt.status))
      )
        return { status: RUN_STATUS.cancelled, results };
      if (attempt?.status === RUN_STATUS.cancelled)
        return { status: RUN_STATUS.failed, results };
      if (attempt?.status === RUN_STATUS.failed) {
        if (attempt.retryable === false || attempt.attempt >= call.maxAttempts)
          return { status: RUN_STATUS.failed, results };
        const retryAt = Date.parse(attempt.finishedAt!) + call.retryBackoffMs;
        if (Date.now() < retryAt) {
          state.wakeAt = new Date(retryAt);
          return { status: RUN_STATUS.waiting, results };
        }
      }
      if (!attempt || attempt.status === RUN_STATUS.failed) {
        let number = 1;
        if (attempt) number = attempt.attempt + 1;
        const executionId = automationDigest(
          `${invocation.executionKey}:${index}:${number}:${call.sha256}`,
        );
        attempt = {
          index,
          attempt: number,
          executionId,
          script: { key: call.key, version: call.version, sha256: call.sha256 },
          status: RUN_STATUS.running,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          output: {},
          exitCode: null,
        };
        attempts.push(attempt);
        latestAttempts.set(index, attempt);
        await context.control.save();
      }
      await refreshStop();
      if (invocation.stopRequested)
        await this.runner.cancel(attempt.executionId, script.target);
      await this.runner.start(attempt.executionId, script, call, {
        context: {
          business: invocation.business,
          actorId: invocation.actorId,
          stepKey: invocation.stepKey,
          executionKey: invocation.executionKey,
          scriptIndex: index,
          attempt: attempt.attempt,
        },
        params: validParams,
        previous: results,
      });
      const observed = await this.runner.read(
        attempt.executionId,
        script.target,
      );
      await refreshStop();
      if (
        observed.status === RUN_STATUS.running ||
        observed.status === RUN_STATUS.unconfirmed
      ) {
        if (invocation.stopRequested)
          await this.runner.cancel(attempt.executionId, script.target);
        attempt.status = observed.status;
        state.wakeAt = new Date(Date.now() + 1000);
        return { status: RUN_STATUS.waiting, results };
      }
      requireExecutionState(
        observed.script.key === call.key &&
          observed.script.version === call.version &&
          observed.script.sha256 === call.sha256,
        '脚本回执的版本或摘要不匹配',
      );
      attempt.status = observed.status;
      attempt.finishedAt = new Date().toISOString();
      attempt.exitCode = observed.exitCode;
      attempt.output = observed.output;
      if (observed.status === RUN_STATUS.succeeded) {
        try {
          attempt.output = validateDataValues(
            script.resultSchema,
            observed.output,
          );
        } catch {
          attempt.status = RUN_STATUS.failed;
          attempt.retryable = false;
          await context.control.save();
          return { status: RUN_STATUS.failed, results };
        }
        results.push({ ...observed, output: attempt.output });
      }
      await context.control.save();
      if (observed.status !== RUN_STATUS.succeeded) {
        if (invocation.stopRequested)
          return { status: RUN_STATUS.cancelled, results };
        if (
          observed.status === RUN_STATUS.failed &&
          attempt.attempt < call.maxAttempts
        ) {
          state.wakeAt = new Date(Date.now() + call.retryBackoffMs);
          return { status: RUN_STATUS.waiting, results };
        }
        return { status: RUN_STATUS.failed, results };
      }
      if (invocation.stopRequested)
        return { status: RUN_STATUS.cancelled, results };
    }
    if (invocation.stopRequested)
      return { status: RUN_STATUS.cancelled, results };
    return { status: RUN_STATUS.succeeded, results };
  }
}
