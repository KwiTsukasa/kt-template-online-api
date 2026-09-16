import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { definitionRecord } from '@/common/automation/definition.types';
import { validateDefinitionInput } from '@/common/automation/definition.repository';
import { FORM_DEFINITIONS, type FormDefinitionPort } from '@/modules/form-definition/contract/form.types';
import { WorkflowBpmnActivity } from '../infrastructure/persistence/workflow-bpmn.entity';
import { WorkflowRun } from '../infrastructure/persistence/workflow-run.entities';
import { validateDataValues } from '@/common/automation/data-schema';
import { WorkflowProcessRegistry } from './workflow-process.registry';
import type { WorkflowHumanTaskView } from '../contract/workflow-run.types';

@Injectable()
export class WorkflowHumanTaskService {
  constructor(
    private readonly database: DataSource,
    @Inject(FORM_DEFINITIONS) private readonly forms: FormDefinitionPort,
    private readonly processes: WorkflowProcessRegistry,
  ) {}

  /**
   * 读取当前实例仍在等待的人工活动及固定表单，已撤销或终态实例不再产生待办。
   * @param runId - 已经由业务权限边界确认的流程实例。
   * @returns 按活动实例区分的待办，回环和并行活动不会共享提交身份。
   */
  async pending(runId: string): Promise<WorkflowHumanTaskView[]> {
    const run = await this.database.getRepository(WorkflowRun).findOneBy({ id: runId });
    if (!run || run.cancelRequested || run.errorMessage || !['pending', 'running', 'waiting'].includes(run.status)) return [];
    const activities = await this.database.getRepository(WorkflowBpmnActivity).findBy({ runId, delivered: false, cancelRequested: false });
    const result: WorkflowHumanTaskView[] = [];
    for (const activity of activities) {
      const step = activity.job.step;
      if (step.kind !== 'human' || activity.state.status !== 'waiting') continue;
      let form = null;
      if (step.formRef) form = await this.forms.resolve(step.formRef);
      result.push({
        name: activity.job.name ?? activity.elementId, executionId: activity.executionId, nodeId: activity.elementId, visit: activity.state.visit,
        formRef: step.formRef, form, writableFields: step.writableFields,
        values: activity.state.preparedInput ?? {},
      });
    }
    return result;
  }

  /**
   * 在流程独占锁内校验人工输入并提交结果意图，后续节点仍由原实例的工作流执行器推进。
   * @param runId - 已授权的业务流程实例。
   * @param executionId - 当前待办的准确活动实例，不能使用节点标识代替。
   * @param actorId - 认证边界确定的办理人，不能由提交字段指定。
   * @param input - 本次填写的可写字段，无表单确认只接受 confirmed 为 true。
   * @throws 实例终止、待办过期、越权字段或同一待办重复提交不同内容时拒绝变更。
   */
  async submit(runId: string, executionId: string, actorId: string, input: unknown): Promise<void> {
    const values = validateDefinitionInput(() => definitionRecord(input));
    const hash = createHash('sha256').update(JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
    const connection = this.database.createQueryRunner();
    const lock = `kt:workflow:${runId}`;
    let acquired = false;
    try {
      await connection.connect();
      acquired = Number((await connection.query('SELECT GET_LOCK(?, 3) acquired', [lock]))[0]?.acquired) === 1;
      if (!acquired) throw new ConflictException('流程正在推进，请稍后提交');
      await connection.manager.transaction(async (manager) => {
        const run = await manager.findOne(WorkflowRun, { where: { id: runId }, lock: { mode: 'pessimistic_write' } });
        const activity = await manager.findOneBy(WorkflowBpmnActivity, { runId, executionId });
        if (!run || !activity || activity.job.step.kind !== 'human') throw new NotFoundException('人工待办不存在');
        const previous = activity.job.submission;
        if (previous) {
          if (previous.actorId === actorId && previous.hash === hash) return;
          throw new ConflictException('该待办已经提交了不同内容');
        }
        const runActive = !run.cancelRequested && !run.errorMessage && ['pending', 'running', 'waiting'].includes(run.status);
        const activityWaiting = !activity.cancelRequested && !activity.delivered && activity.state.status === 'waiting';
        if (!runActive || !activityWaiting || new Date(run.deadlineAt).getTime() <= Date.now())
          throw new ConflictException('该人工待办已经失效');
        const step = activity.job.step;
        let output: Record<string, unknown>;
        if (step.formRef) {
          if (Object.keys(values).some((key) => !step.writableFields.includes(key))) throw new BadRequestException('提交包含当前节点不可写的字段');
          output = await this.forms.validate(step.formRef, { ...activity.state.preparedInput, ...values });
        } else {
          if (values.confirmed !== true || Object.keys(values).length !== 1) throw new BadRequestException('请确认当前步骤');
          output = { confirmed: true };
        }
        if (step.businessKey) {
          if (!run.businessContext) throw new ConflictException('人工办理缺少业务实例身份');
          const process = this.processes.resolve(run.businessContext.processRef);
          const capability = process.humanSteps?.find((item) => item.key === step.businessKey);
          if (!capability || !process.acceptHumanStep) throw new ConflictException('业务人工办理能力未装配');
          const accepted = await process.acceptHumanStep({ business: run.businessContext, executionId, stepKey: step.businessKey, actorId, values: output, transaction: manager });
          const businessOutput = validateDefinitionInput(() => validateDataValues(capability.outputSchema, accepted));
          if (Object.keys(businessOutput).some((key) => key in output)) throw new ConflictException('表单字段不能覆盖业务权威结果');
          output = { ...output, ...businessOutput };
        }
        activity.job.submission = { actorId, hash, submittedAt: new Date().toISOString() };
        activity.state.outputValues = output;
        activity.state.status = 'succeeded';
        activity.state.finishedAt = new Date();
        await manager.save(WorkflowBpmnActivity, activity);
        await manager.update(WorkflowRun, { id: runId }, { nextWakeAt: new Date() });
      });
    } finally {
      try { if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [lock]); }
      finally { await connection.release(); }
    }
  }
}
