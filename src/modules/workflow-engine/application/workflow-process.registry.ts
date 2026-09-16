import { BadRequestException, Injectable } from '@nestjs/common';
import { normalizeDataSchema } from '@/common/automation/data-schema';
import type {
  WorkflowProcess,
  WorkflowProcessReference,
  WorkflowProcessRegistryPort,
} from '../contract/workflow-process.interface';

@Injectable()
export class WorkflowProcessRegistry implements WorkflowProcessRegistryPort {
  private readonly entries = new Map<
    string,
    { process: WorkflowProcess; signature: string }
  >();

  /**
   * 注册业务实现的流程接口，校验公开步骤契约，不启动业务执行器或定时恢复任务。
   * @param process - 业务模块实现的流程接口实例。
   * @returns 仅撤销该实例当前注册的释放函数。
   * @throws 流程身份、步骤声明、实现方法或版本唯一性不满足约束时拒绝注册。
   */
  register(process: WorkflowProcess): () => void {
    if (process.concurrencyGroup !== undefined && !/^[a-z][a-z0-9.-]{2,63}$/.test(process.concurrencyGroup))
      throw new Error('业务流程并发组身份无效');
    if (
      !/^[a-z][a-z0-9.-]{2,63}$/.test(process.key) ||
      !Number.isSafeInteger(process.version) ||
      process.version < 1
    )
      throw new Error('业务流程接口身份或版本无效');
    const validName = typeof process.name === 'string' && !!process.name.trim();
    const lifecycleImplemented = [process.prepare, process.prepareStep, process.acceptStep, process.stopStep, process.complete].every((method) => typeof method === 'function');
    if (!validName || !lifecycleImplemented)
      throw new Error('业务流程接口实现不完整');
    const key = `${process.key}@${process.version}`;
    if (this.entries.has(key)) throw new Error('业务流程接口版本重复注册');
    if (
      !Array.isArray(process.steps) ||
      !process.steps.length ||
      process.steps.length > 100
    )
      throw new Error('业务流程需声明 1 至 100 个步骤能力');
    const stepKeys = new Set<string>();
    for (const step of process.humanSteps ?? []) {
      if (!/^[a-z][a-z0-9.-]{1,63}$/.test(step.key) || stepKeys.has(step.key) || !step.name?.trim() || typeof process.acceptHumanStep !== 'function') throw new Error('人工办理能力声明或实现无效');
      stepKeys.add(step.key);
      normalizeDataSchema(step.outputSchema);
    }
    for (const step of process.steps) {
      if (
        !/^[a-z][a-z0-9.-]{1,63}$/.test(step.key) ||
        stepKeys.has(step.key) ||
        typeof step.name !== 'string' ||
        !step.name.trim() ||
        typeof step.description !== 'string'
      )
        throw new Error('业务流程步骤身份或名称无效');
      stepKeys.add(step.key);
      normalizeDataSchema(step.inputSchema);
      normalizeDataSchema(step.outputSchema);
    }
    this.entries.set(key, {
      process,
      signature: JSON.stringify(this.describe(process)),
    });
    return () => {
      if (this.entries.get(key)?.process === process) this.entries.delete(key);
    };
  }

  /**
   * 只读取实例或节点保存的精确业务接口版本，不回落到最新业务实现。
   * @param reference - 固定业务流程类型与接口版本。
   * @returns 当前装配的业务流程接口实例。
   * @throws 指定版本未装配时拒绝执行。
   */
  resolve(reference: WorkflowProcessReference): WorkflowProcess {
    const entry = this.entries.get(`${reference.key}@${reference.version}`);
    if (!entry) throw new BadRequestException('业务流程接口版本未加载');
    if (JSON.stringify(this.describe(entry.process)) !== entry.signature)
      throw new BadRequestException(
        '业务流程接口契约在注册后发生变化，必须发布新接口版本',
      );
    return entry.process;
  }

  /**
   * 为工作流编排器复制业务接口及步骤输入输出目录，不暴露实现函数或可变内部状态。
   * @returns 可选择的固定业务流程接口与步骤能力。
   */
  catalog() {
    return [...this.entries.values()].map(({ process }) =>
      this.describe(this.resolve(process)),
    );
  }

  /**
   * 复制可序列化的接口元数据，用于目录返回和运行前的契约漂移检查。
   * @param process - 已注册的业务流程实现。
   * @returns 不持有原步骤字段引用的业务契约。
   */
  private describe(process: WorkflowProcess) {
    return {
      key: process.key,
      version: process.version,
      name: process.name,
      concurrencyGroup: process.concurrencyGroup,
      launchSchema: normalizeDataSchema(process.launchSchema ?? { fields: [] }),
      inputSchema: normalizeDataSchema(process.inputSchema),
      outputSchema: normalizeDataSchema(process.outputSchema),
      humanSteps: (process.humanSteps ?? []).map((step) => ({ key: step.key, name: step.name, outputSchema: normalizeDataSchema(step.outputSchema) })),
      steps: process.steps.map((step) => ({
        key: step.key,
        name: step.name,
        description: step.description,
        inputSchema: normalizeDataSchema(step.inputSchema),
        outputSchema: normalizeDataSchema(step.outputSchema),
      })),
    };
  }
}
