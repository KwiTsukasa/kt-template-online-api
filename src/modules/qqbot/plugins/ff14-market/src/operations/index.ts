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
 * 创建 FF14 市场插件对象或配置。
 * @param application - application 输入；驱动 `createFf14MarketPriceOperation()` 的 FF14 市场步骤。
 * @param operations - FF14 市场列表；转换 FF14 市场列表项。
 */
export function buildFf14MarketOperations(
  application: Ff14MarketApplication,
  operations: Ff14MarketManifestOperation[],
) {
  const operationFactories = {
    /**
     * 执行 FF14 市场回调。
     */
    [ff14PricePriceHandlerName]: () =>
      createFf14MarketPriceOperation(application),
    /**
     * 执行 FF14 市场回调。
     */
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
