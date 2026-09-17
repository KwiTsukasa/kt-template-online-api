import { resolve } from 'node:path';

/**
 * 从 API 发布目录定位受控运行资产，保持源码执行与编译产物执行一致。
 * @param filename - 随 API 一起发布的包装器、协议或远端控制程序。
 * @returns 不依赖调用进程当前目录的固定资产绝对路径。
 */
export function workflowRuntimeAsset(
  filename: 'run-script.mjs' | 'script-protocol.mjs' | 'remote-control.cjs',
): string {
  return resolve(__dirname, '../../../../scripts/workflow', filename);
}
