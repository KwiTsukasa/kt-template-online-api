import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { validateDataValues } from '@/common/automation/data-schema';
import type { WorkflowStepInvocation } from '../contract/workflow-process.interface';
import type {
  WorkflowScriptCall,
  WorkflowScriptResult,
} from '../contract/workflow-script.types';
import type { WorkflowNodeRun } from '../infrastructure/persistence/workflow-run.entities';
import { WorkflowScriptRunner } from '../infrastructure/workflow-script.runner';
import { WorkflowScriptRegistry } from './workflow-script.registry';

type ScriptBatch = {
  status: 'waiting' | 'failed' | 'cancelled' | 'succeeded';
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
   * @param processKey - 当前业务接口标识。
   * @param state - 节点拥有的密封准备参数及脚本尝试账本。
   * @param mappedParams - 按脚本顺序从图输入与上游映射得到的显式业务参数。
   * @param persist - 在启动脚本之前持久化尝试意图的工作流回调。
   * @returns 当前脚本批次状态与已经证实的有序结果。
   * @throws 脚本契约、参数或回执身份不相容时拒绝继续派发。
   */
  async advance(
    calls: WorkflowScriptCall[],
    invocation: WorkflowStepInvocation,
    processKey: string,
    state: WorkflowNodeRun,
    mappedParams: Record<string, unknown>[],
    persist: () => Promise<void>,
  ): Promise<ScriptBatch> {
    if (!calls.length || !state.preparedInput)
      throw new Error('步骤脚本或密封参数缺失');
    const attempts = state.scriptAttempts || [];
    state.scriptAttempts = attempts;
    const results: WorkflowScriptResult[] = [];
    for (const [index, call] of calls.entries()) {
      const script = this.registry.check(call, processKey, invocation.stepKey);
      const params: Record<string, unknown> = { ...script.defaults };
      for (const field of script.paramsSchema.fields) {
        if (Object.hasOwn(state.preparedInput, field.key))
          params[field.key] = state.preparedInput[field.key];
      }
      for (const [key, value] of Object.entries(mappedParams[index])) {
        if (Object.hasOwn(state.preparedInput, key))
          throw new Error('脚本参数不能覆盖业务密封参数');
        params[key] = value;
      }
      const validParams = validateDataValues(script.paramsSchema, params);
      let attempt = attempts
        .filter((attempt) => attempt.index === index)
        .at(-1);
      if (attempt?.status === 'succeeded') {
        results.push({
          executionId: attempt.executionId,
          script: attempt.script,
          status: 'succeeded',
          exitCode: attempt.exitCode,
          output: attempt.output,
        });
        continue;
      }
      if (
        invocation.stopRequested &&
        (!attempt || ['failed', 'cancelled'].includes(attempt.status))
      )
        return { status: 'cancelled', results };
      if (attempt?.status === 'cancelled') return { status: 'failed', results };
      if (attempt?.status === 'failed') {
        if (attempt.retryable === false || attempt.attempt >= call.maxAttempts)
          return { status: 'failed', results };
        const retryAt = Date.parse(attempt.finishedAt!) + call.retryBackoffMs;
        if (Date.now() < retryAt) {
          state.wakeAt = new Date(retryAt);
          return { status: 'waiting', results };
        }
      }
      if (!attempt || attempt.status === 'failed') {
        let number = 1;
        if (attempt) number = attempt.attempt + 1;
        const executionId = createHash('sha256')
          .update(
            `${invocation.executionKey}:${index}:${number}:${call.sha256}`,
          )
          .digest('hex');
        attempt = {
          index,
          attempt: number,
          executionId,
          script: { key: call.key, version: call.version, sha256: call.sha256 },
          status: 'running',
          startedAt: new Date().toISOString(),
          finishedAt: null,
          output: {},
          exitCode: null,
        };
        attempts.push(attempt);
        await persist();
      }
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
      if (observed.status === 'running' || observed.status === 'unconfirmed') {
        attempt.status = observed.status;
        state.wakeAt = new Date(Date.now() + 1000);
        return { status: 'waiting', results };
      }
      if (
        observed.script.key !== call.key ||
        observed.script.version !== call.version ||
        observed.script.sha256 !== call.sha256
      )
        throw new Error('脚本回执的版本或摘要不匹配');
      attempt.status = observed.status;
      attempt.finishedAt = new Date().toISOString();
      attempt.exitCode = observed.exitCode;
      attempt.output = observed.output;
      if (observed.status === 'succeeded') {
        try {
          attempt.output = validateDataValues(
            script.resultSchema,
            observed.output,
          );
        } catch {
          attempt.status = 'failed';
          attempt.retryable = false;
          await persist();
          return { status: 'failed', results };
        }
        results.push({ ...observed, output: attempt.output });
      }
      await persist();
      if (observed.status !== 'succeeded') {
        if (invocation.stopRequested) return { status: 'cancelled', results };
        if (
          observed.status === 'failed' &&
          attempt.attempt < call.maxAttempts
        ) {
          state.wakeAt = new Date(Date.now() + call.retryBackoffMs);
          return { status: 'waiting', results };
        }
        return { status: 'failed', results };
      }
      if (invocation.stopRequested) return { status: 'cancelled', results };
    }
    return { status: 'succeeded', results };
  }
}
