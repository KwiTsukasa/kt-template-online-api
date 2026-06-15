import { Injectable } from '@nestjs/common';
import { DictService } from '@/modules/admin/platform-config/dict/dict.service';
import type { QqbotPluginExecutionInput } from '@/modules/qqbot/core/domain/plugin-execution.port';
import {
  buildQqbotFf14MarketCatalog,
  buildQqbotFf14MarketCatalogFromTree,
  isQqbotFf14LocationName,
  parseQqbotFf14MarketPriceInput,
  QQBOT_FF14_MARKET_DICT_CODES,
  splitQqbotFf14WorldPath,
  type QqbotFf14MarketCatalog,
} from '@/modules/qqbot/plugins/ff14-market/src';
import { parseQqbotFflogsCharacterInput } from '@/modules/qqbot/plugins/fflogs/src';
import type { QqbotPluginInputNormalizerPort } from '../../../application/argument/plugin-input-normalizer.port';

@Injectable()
export class QqbotPluginInputNormalizerService
  implements QqbotPluginInputNormalizerPort
{
  constructor(private readonly dictService: DictService) {}

  async normalizeInput(input: QqbotPluginExecutionInput) {
    const parserKey = `${input.context?.command?.parserKey || 'plain'}`.trim();
    const rawArgs = `${input.input?.raw ?? input.input?.text ?? ''}`.trim();
    if (parserKey === 'ff14Price') {
      return {
        ...input.input,
        ...this.removeEmpty(
          parseQqbotFf14MarketPriceInput(
            rawArgs,
            await this.getFf14MarketCatalog(),
          ),
        ),
      };
    }
    if (parserKey === 'fflogsCharacter') {
      const catalog = await this.getFf14MarketCatalog();
      return {
        ...input.input,
        ...this.removeEmpty(
          parseQqbotFflogsCharacterInput(rawArgs, {
            resolveKnownWorld: (candidate) => {
              if (!isQqbotFf14LocationName(catalog, candidate)) return null;
              const worldPath = splitQqbotFf14WorldPath(candidate);
              return { serverSlug: worldPath.world || candidate };
            },
          }),
        ),
      };
    }
    return input.input;
  }

  private async getFf14MarketCatalog(): Promise<QqbotFf14MarketCatalog> {
    const treeCatalog = buildQqbotFf14MarketCatalogFromTree(
      await this.dictService.relationTree({
        dictCode: QQBOT_FF14_MARKET_DICT_CODES.region,
      }),
    );
    if (treeCatalog.dataCenters.length > 0) return treeCatalog;

    const [regions, dataCenters, worlds] = await Promise.all([
      this.dictService.getDictItemsByKey(QQBOT_FF14_MARKET_DICT_CODES.region),
      this.dictService.getDictItemsByKey(
        QQBOT_FF14_MARKET_DICT_CODES.dataCenter,
      ),
      this.dictService.getDictItemsByKey(QQBOT_FF14_MARKET_DICT_CODES.world),
    ]);
    return buildQqbotFf14MarketCatalog({
      dataCenters,
      regions,
      worlds,
    });
  }

  private removeEmpty(input: Record<string, any>) {
    return Object.entries(input).reduce<Record<string, any>>(
      (result, [key, value]) => {
        if (value !== undefined && value !== '') result[key] = value;
        return result;
      },
      {},
    );
  }
}
