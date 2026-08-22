import type { Ff14MarketApplication } from '../application/ff14-market-application';
import {
  createFf14MarketPriceOperation,
  ff14PricePriceHandlerName,
} from './market-price';
import type { Ff14MarketManifestOperation } from './operation-manifest';
import {
  createFf14ResolveItemOperation,
  ff14ResolveItemHandlerName,
} from './resolve-item';

/**
 * 根据`application`、`operations`构造针对FF14 市场插件。
 * @param application - 决定针对FF14 市场插件内容、边界或目标的 `application` 值。
 * @param operations - 按原有顺序参与针对FF14 市场插件筛选、合并或汇总的集合。
 * @returns 针对FF14 市场插件。
 */
export function buildFf14MarketOperations(
  application: Ff14MarketApplication,
  operations: Ff14MarketManifestOperation[],
) {
  const operationFactories = {
    [ff14PricePriceHandlerName]: () =>
      createFf14MarketPriceOperation(application),
    [ff14ResolveItemHandlerName]: () =>
      createFf14ResolveItemOperation(application),
  } satisfies Record<
    string,
    () => {
      execute: (input: Record<string, any>) => Promise<unknown>;
      inputSchema: Record<string, unknown>;
      outputSchema: Record<string, unknown>;
    }
  >;

  return operations.map((operation) => {
    const factory = operationFactories[operation.handlerName];
    if (!factory) {
      throw new Error(`FF14 插件能力未实现：${operation.handlerName}`);
    }
    const implementation = factory();
    return {
      aliases: operation.aliases,
      cacheTtlMs: operation.cacheTtlMs,
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
  Ff14MarketManifest,
  Ff14MarketManifestOperation,
} from './operation-manifest';
