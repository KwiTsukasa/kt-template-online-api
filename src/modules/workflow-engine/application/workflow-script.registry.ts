import { requireExecutionState } from '@/common/automation/validation';
import { Injectable } from '@nestjs/common';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  normalizeWorkflowScriptDeclaration,
  normalizeWorkflowScriptReference,
} from '../domain/workflow-script-declaration.policy';
import type {
  WorkflowScriptCall,
  WorkflowScriptDefinition,
  WorkflowScriptReference,
} from '../contract/workflow-script.types';

@Injectable()
export class WorkflowScriptRegistry {
  private readonly scripts = new Map<string, WorkflowScriptDefinition>();

  /**
   * 注册由发布产物提供的固定脚本，页面不能注册文件路径或自由命令。
   * @param script - 内容摘要、执行目标、解释器和业务步骤适用范围。
   * @returns 只释放本次脚本注册的函数。
   * @throws 脚本元数据不合法或同版本契约漂移时拒绝装配。
   */
  register(script: WorkflowScriptDefinition): () => void {
    const reference = normalizeWorkflowScriptReference(script);
    const declaration = normalizeWorkflowScriptDeclaration(script);
    requireExecutionState(
      isAbsolute(script.path) &&
        !script.path.includes('\0') &&
        ['bash', 'node', 'python'].includes(script.runtime) &&
        ['local', 'nas'].includes(script.target),
      '工作流脚本路径、解释器或目标不支持',
    );
    const key = `${reference.key}@${reference.version}`;
    const frozen = Object.freeze({ ...script, ...reference, ...declaration });
    const existing = this.scripts.get(key);
    if (existing) {
      requireExecutionState(
        isDeepStrictEqual(existing, frozen),
        '工作流脚本同版本契约漂移',
      );
      return () => {};
    }
    this.scripts.set(key, frozen);
    return () => {
      if (this.scripts.get(key) === frozen) this.scripts.delete(key);
    };
  }

  /**
   * 按工作流保存的精确版本及摘要解析脚本，缺失版本不回落。
   * @param reference - 工作流固定的脚本引用。
   * @returns 注册时冻结的脚本元数据副本。
   * @throws 版本缺失或内容摘要漂移时拒绝执行。
   */
  resolve(reference: WorkflowScriptReference): WorkflowScriptDefinition {
    const script = this.scripts.get(`${reference.key}@${reference.version}`);
    requireExecutionState(
      script && script.sha256 === reference.sha256,
      '工作流脚本版本或内容摘要不可用',
    );
    return structuredClone(script);
  }

  /**
   * 校验工作流对脚本的调用策略，禁止跨步骤误用和对非幂等脚本自动重试。
   * @param call - 节点保存的脚本版本与执行策略。
   * @param processKey - 节点所在业务接口。
   * @param stepKey - 当前业务步骤。
   * @returns 与调用策略相容的脚本元数据。
   * @throws 适用范围、超时或重试次数违反脚本契约时拒绝发布和启动。
   */
  check(
    call: WorkflowScriptCall,
    processKey: string,
    stepKey: string,
  ): WorkflowScriptDefinition {
    const script = this.resolve(call);
    requireExecutionState(
      script.processKey === processKey && script.stepKey === stepKey,
      '脚本不适用于当前业务步骤',
    );
    requireExecutionState(
      !(call.timeoutMs > script.maxTimeoutMs) &&
        (!(call.maxAttempts > 1) || script.idempotent),
      '脚本超时或自动重试不符合固定契约',
    );
    return script;
  }

  /**
   * 提供脚本选择目录，仅返回公开执行方式与摘要，不暴露主机文件路径。
   * @returns 可供编排器按业务步骤筛选的脚本目录。
   */
  catalog() {
    return [...this.scripts.values()].map(({ path: scriptPath, ...script }) => {
      void scriptPath;
      return structuredClone(script);
    });
  }
}
