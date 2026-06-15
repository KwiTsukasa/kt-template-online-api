import type { FflogsApplication } from '../application/fflogs-application';
import {
  createFflogsCharacterSummaryOperation,
  fflogsCharacterSummaryHandlerName,
} from './character-summary';
import type { FflogsManifestOperation } from './operation-manifest';

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
      cacheTtlMs: operation.cacheTtlMs || implementation.cacheTtlMs,
      description: operation.description,
      execute: implementation.execute,
      inputSchema: operation.inputSchema || implementation.inputSchema,
      key: operation.key,
      name: operation.name,
      outputSchema: operation.outputSchema || implementation.outputSchema,
    };
  });
}

export type { FflogsManifest, FflogsManifestOperation } from './operation-manifest';
