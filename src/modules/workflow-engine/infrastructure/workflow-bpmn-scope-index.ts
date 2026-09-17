export class WorkflowBpmnScopeIndex<
  T extends { executionId: string; parentExecutionIds: string[] },
> {
  private readonly jobs = new Map<string, T>();
  private readonly scopes = new Map<string, Set<string>>();

  /**
   * 登记活动及其所属作用域，重放同一身份时先移除旧归属。
   * @param executionId - 本次活动实例身份。
   * @param job - 包含完整父作用域的派发意图。
   */
  set(executionId: string, job: T): void {
    this.delete(executionId);
    this.jobs.set(executionId, job);
    for (const scope of job.parentExecutionIds) {
      const members = this.scopes.get(scope) ?? new Set<string>();
      members.add(executionId);
      this.scopes.set(scope, members);
    }
  }

  /**
   * 移除一个活动和它的反向归属，后续重复取消不再扫描或返回该活动。
   * @param executionId - 要移除的精确活动身份。
   */
  delete(executionId: string): void {
    const job = this.jobs.get(executionId);
    if (!job) return;
    this.jobs.delete(executionId);
    for (const scope of job.parentExecutionIds) {
      const members = this.scopes.get(scope);
      members?.delete(executionId);
      if (!members?.size) this.scopes.delete(scope);
    }
  }

  /**
   * 只撤销指定作用域的后代任务，其他并行分支保持原有执行意图。
   * @param scope - 已中断或终止的作用域身份。
   * @param cancelled - 本轮待外部确认退出的活动集合。
   */
  cancelScope(scope: string | undefined, cancelled?: Set<string>): void {
    if (!scope) return;
    const members = this.scopes.get(scope);
    if (!members) return;
    for (const executionId of members) {
      this.delete(executionId);
      cancelled?.add(executionId);
    }
  }

  /**
   * 直接读取仍属于当前活动集合的实例，不重新遍历其他作用域。
   * @param executionId - 精确实例身份。
   * @returns 当前实例记录；已经撤销或完成时为空。
   */
  get(executionId: string): T | undefined {
    return this.jobs.get(executionId);
  }

  /**
   * 按登记顺序读取仍待派发的意图，迭代时允许移除当前项。
   * @returns 当前活动意图的原生迭代器。
   */
  values(): MapIterator<T> {
    return this.jobs.values();
  }
}
