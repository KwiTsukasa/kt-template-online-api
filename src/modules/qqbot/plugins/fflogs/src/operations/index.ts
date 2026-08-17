import type { FflogsApplication } from '../application/fflogs-application';
import {
  createFflogsCharacterSummaryOperation,
  fflogsCharacterSummaryHandlerName,
} from './character-summary';
import type { FflogsManifestOperation } from './operation-manifest';

/**
 * 根据`application`、`operations`构造Fflogs操作集合。
 * @param application - 决定Fflogs操作集合内容、边界或目标的 `application` 值。
 * @param operations - 按原有顺序参与Fflogs操作集合筛选、合并或汇总的集合。
 * @returns Fflogs操作集合。
 */
export function buildFflogsOperations(
  application: FflogsApplication,
  operations: FflogsManifestOperation[],
) {
  const operationFactories = {
    [fflogsCharacterSummaryHandlerName]: () =>
      createFflogsCharacterSummaryOperation(application),
  } satisfies Record<
    string,
    () => {
      cacheTtlMs?: number;
      execute: (input: Record<string, any>) => Promise<unknown>;
      inputSchema: Record<string, unknown>;
      outputSchema: Record<string, unknown>;
    }
  >;

  return operations.map((operation) => {
    const factory = operationFactories[operation.handlerName];
    if (!factory) {
      throw new Error(`FFLogs 插件能力未实现：${operation.handlerName}`);
    }
    const implementation = factory();
    return {
      aliases: operation.aliases,
      cacheTtlMs: operation.cacheTtlMs || implementation.cacheTtlMs,
      description: operation.description,
      execute: implementation.execute,
      inputSchema: operation.inputSchema || implementation.inputSchema,
      key: operation.key,
      name: operation.name,
      outputSchema: operation.outputSchema || implementation.outputSchema,
      timeoutMs: operation.timeoutMs,
    };
  });
}

export type {
  FflogsManifest,
  FflogsManifestOperation,
} from './operation-manifest';
