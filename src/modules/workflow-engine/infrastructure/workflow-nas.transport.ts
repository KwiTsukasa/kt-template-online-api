import { requireExecutionState } from '@/common/automation/validation';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { workflowRuntimeAsset } from './workflow-runtime-assets';

import { SCRIPT_LIMITS, SCRIPT_PATTERN } from '../constants/script';

/**
 * 把固定命令参数编码为一个 POSIX shell 参数，业务输入只通过标准输入传输。
 * @param value - 已验证的解释器路径或仓库内控制程序。
 * @returns 不会被远端 shell 拆词或展开的参数。
 */
function shellArgument(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

@Injectable()
export class WorkflowNasTransport {
  constructor(private readonly config: ConfigService) {}

  /**
   * 通过已配置 SSH 身份调用一次性工作流控制程序，不依赖远端常驻流程服务。
   * @param operation - 启动、读取回执或写入取消意图。
   * @param executionId - 固定尝试身份。
   * @param payload - 启动时需要的密封清单和文件内容，读取与取消时为空。
   * @returns 远端控制程序的 JSON 回执。
   * @throws 配置、主机校验、传输超时或回执结构不合法时拒绝把操作视为成功。
   */
  async request(
    operation: 'start' | 'read' | 'cancel',
    executionId: string,
    payload: Record<string, unknown> = {},
  ): Promise<unknown> {
    const host = this.config.get<string>('WORKFLOW_NAS_SSH_HOST') || '';
    const root = this.config.get<string>('WORKFLOW_NAS_STATE_ROOT') || '';
    const node = this.config.get<string>('WORKFLOW_NAS_NODE_BINARY') || '';
    const sshConfig = this.config.get<string>('WORKFLOW_NAS_SSH_CONFIG') || '';
    requireExecutionState(
      /^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/.test(host) &&
        path.posix.isAbsolute(root) &&
        root !== '/' &&
        path.posix.isAbsolute(node) &&
        SCRIPT_PATTERN.sha256.test(executionId),
      '工作流 NAS 主机、状态目录或解释器尚未配置',
    );
    const sshArguments: string[] = [];
    if (sshConfig) {
      requireExecutionState(
        path.isAbsolute(sshConfig),
        '工作流 SSH 配置必须使用绝对路径',
      );
      await access(sshConfig);
      sshArguments.push('-F', sshConfig);
    }
    const helper = await readFile(
      workflowRuntimeAsset('remote-control.cjs'),
      'utf8',
    );
    const command = `${shellArgument(node)} -e ${shellArgument(helper)}`;
    const input = JSON.stringify({
      ...payload,
      operation,
      executionId,
      root,
      nodeBinary: node,
    });
    requireExecutionState(
      !(Buffer.byteLength(input) > SCRIPT_LIMITS.controlEnvelopeBytes),
      '工作流 NAS 输入超过传输限制',
    );
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        'ssh',
        [
          ...sshArguments,
          '-T',
          '-o',
          'BatchMode=yes',
          '-o',
          'StrictHostKeyChecking=yes',
          '-o',
          'ConnectTimeout=10',
          host,
          command,
        ],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let output = '';
      let outputBytes = 0;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill();
        reject(error);
      };
      const timeout = setTimeout(
        () => fail(new Error('工作流 NAS 控制请求超时，执行状态待核对')),
        SCRIPT_LIMITS.controlTimeoutMs,
      );
      child.on('error', () => fail(new Error('工作流 NAS SSH 无法启动')));
      child.stdin.on('error', () => fail(new Error('工作流 NAS 输入传输中断')));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (part: string) => {
        outputBytes += Buffer.byteLength(part);
        if (outputBytes > SCRIPT_LIMITS.controlEnvelopeBytes)
          return fail(new Error('工作流 NAS 回执超过限制'));
        output += part;
      });
      child.stderr.resume();
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code !== 0)
          reject(new Error('工作流 NAS 控制请求未确认，保留原尝试等待核对'));
        else resolve(output);
      });
      child.stdin.end(input);
    });
    const response = JSON.parse(raw) as {
      executionId?: string;
      value?: unknown;
    };
    requireExecutionState(
      response.executionId === executionId,
      '工作流 NAS 回执身份不匹配',
    );
    return response.value;
  }
}
