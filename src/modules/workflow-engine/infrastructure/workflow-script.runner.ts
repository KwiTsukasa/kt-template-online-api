import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type {
  WorkflowScriptCall,
  WorkflowScriptDefinition,
  WorkflowScriptResult,
} from '../contract/workflow-script.types';
import { normalizeWorkflowPayload } from '../domain/workflow-script.policy';
import { WorkflowNasTransport } from './workflow-nas.transport';

export type ScriptObservation =
  | WorkflowScriptResult
  | { status: 'running'; executionId: string }
  | { status: 'unconfirmed'; executionId: string };

@Injectable()
export class WorkflowScriptRunner {
  private readonly nas: WorkflowNasTransport;
  constructor(private readonly config: ConfigService) {
    this.nas = new WorkflowNasTransport(config);
  }

  /**
   * 为一个脚本尝试密封输入并启动临时包装进程，包装进程的独占声明阻止崩溃重放重复执行。
   * @param executionId - 工作流计算的唯一尝试摘要。
   * @param script - 固定脚本版本与受控解释器。
   * @param call - 工作流定义中的超时和重试策略。
   * @param payload - 原业务参数及前序脚本结果。
   * @throws 执行目标未装配、目录配置缺失或同一尝试输入发生变化时拒绝启动。
   */
  async start(
    executionId: string,
    script: WorkflowScriptDefinition,
    call: WorkflowScriptCall,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (script.target === 'nas') {
      const binaryKey = `WORKFLOW_NAS_${script.runtime.toUpperCase()}_BINARY`;
      const binary = this.config.get<string>(binaryKey) || '';
      if (!path.posix.isAbsolute(binary))
        throw new Error('工作流 NAS 脚本解释器需配置绝对路径');
      const [source, wrapper, protocol] = await Promise.all([
        readFile(script.path, 'utf8'),
        readFile(path.resolve('scripts/workflow/run-script.mjs'), 'utf8'),
        readFile(path.resolve('scripts/workflow/script-protocol.mjs'), 'utf8'),
      ]);
      await this.nas.request('start', executionId, {
        source,
        wrapper,
        protocol,
        manifest: {
          executionId,
          script: { key: call.key, version: call.version, sha256: call.sha256 },
          runtime: script.runtime,
          binary,
          timeoutMs: call.timeoutMs,
          payload: normalizeWorkflowPayload(payload),
        },
      });
      return;
    }
    const directory = this.directory(executionId);
    const wrapper = path.resolve(__dirname, '../../../../scripts/workflow/run-script.mjs');
    await access(wrapper);
    let binary = process.execPath;
    if (script.runtime === 'python') {
      binary = this.config.get<string>('WORKFLOW_PYTHON_BINARY') || '';
      if (!path.isAbsolute(binary))
        throw new Error('工作流 Python 解释器需配置绝对路径');
    }
    if (script.runtime === 'bash') {
      binary = this.config.get<string>('WORKFLOW_BASH_BINARY') || '';
      if (!binary && process.platform !== 'win32') binary = '/bin/bash';
      if (!path.isAbsolute(binary))
        throw new Error('工作流 Bash 解释器需配置绝对路径');
    }
    const manifest = {
      executionId,
      script: { key: call.key, version: call.version, sha256: call.sha256 },
      runtime: script.runtime,
      scriptPath: script.path,
      binary,
      timeoutMs: call.timeoutMs,
      payload: normalizeWorkflowPayload(payload),
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const inputFile = path.join(directory, 'input.json');
    try {
      await writeFile(inputFile, JSON.stringify(manifest), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (
        !isDeepStrictEqual(
          JSON.parse(await readFile(inputFile, 'utf8')),
          manifest,
        )
      )
        throw new Error('工作流脚本尝试输入发生变化');
    }
    try {
      await access(path.join(directory, 'claimed'));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [wrapper, directory], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  /**
   * 读取真实脚本退出回执，心跳消失只标为待核对，不能自动重启未知副作用。
   * @param executionId - 当前尝试身份。
   * @param target - 固定脚本版本声明的执行位置。
   * @returns 已结束回执、活动状态或无法确认状态。
   * @throws 结果身份或数据结构不合法时拒绝把它当作成功。
   */
  async read(
    executionId: string,
    target: 'local' | 'nas' = 'local',
  ): Promise<ScriptObservation> {
    if (target === 'nas') {
      const result = (await this.nas.request(
        'read',
        executionId,
      )) as ScriptObservation;
      if (
        result?.executionId !== executionId ||
        ![
          'running',
          'unconfirmed',
          'succeeded',
          'failed',
          'cancelled',
        ].includes(result.status)
      )
        throw new Error('工作流 NAS 脚本回执身份或状态无效');
      if (result.status === 'running' || result.status === 'unconfirmed')
        return result;
      if (
        !('script' in result) ||
        (result.status === 'succeeded' && result.exitCode !== 0)
      )
        throw new Error('工作流 NAS 脚本退出回执无效');
      return { ...result, output: normalizeWorkflowPayload(result.output) };
    }
    const directory = this.directory(executionId);
    try {
      const result = JSON.parse(
        await readFile(path.join(directory, 'result.json'), 'utf8'),
      );
      if (
        result.executionId !== executionId ||
        !['succeeded', 'failed', 'cancelled'].includes(result.status) ||
        !result.script ||
        (result.status === 'succeeded' && result.exitCode !== 0)
      )
        throw new Error('工作流脚本回执身份或状态无效');
      return {
        executionId,
        script: result.script,
        status: result.status,
        exitCode: result.exitCode,
        output: normalizeWorkflowPayload(result.output),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      const heartbeat = JSON.parse(
        await readFile(path.join(directory, 'heartbeat.json'), 'utf8'),
      );
      if (
        heartbeat.executionId === executionId &&
        Date.now() - Date.parse(heartbeat.observedAt) < 10_000
      )
        return { status: 'running', executionId };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return { status: 'unconfirmed', executionId };
  }

  /**
   * 给本次尝试的包装进程写入停止意图，等待真实退出回执，不按历史 PID 强杀进程。
   * @param executionId - 工作流拥有的脚本尝试身份。
   * @param target - 固定脚本版本声明的执行位置。
   */
  async cancel(
    executionId: string,
    target: 'local' | 'nas' = 'local',
  ): Promise<void> {
    if (target === 'nas') {
      await this.nas.request('cancel', executionId);
      return;
    }
    const directory = this.directory(executionId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(directory, 'cancel.json'),
      JSON.stringify({ executionId }),
      { mode: 0o600 },
    );
  }

  /**
   * 将尝试身份限制到配置的工作流状态目录，拒绝相对根目录和路径穿越。
   * @param executionId - 工作流计算的六十四位摘要。
   * @returns 唯一尝试目录的绝对路径。
   * @throws 状态根目录或尝试身份不合法时拒绝文件操作。
   */
  private directory(executionId: string): string {
    const root = this.config.get<string>('WORKFLOW_SCRIPT_STATE_ROOT') || '';
    if (!path.isAbsolute(root) || !/^[a-f0-9]{64}$/.test(executionId))
      throw new Error('工作流脚本状态目录或运行身份无效');
    return path.join(root, executionId);
  }
}
