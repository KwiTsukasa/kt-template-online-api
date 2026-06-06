import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DictService } from '@/admin/dict/dict.service';
import { Card } from '@/qqbot/plugins/bangDream/card/card.model';
import { getPresentEvent } from '@/qqbot/plugins/bangDream/event/event.model';
import { Gacha, getPresentGachaList } from '@/qqbot/plugins/bangDream/gacha/gacha.model';
import {
  BANGDREAM_GACHA_DEFAULT_SPIN_COUNT,
  isBirthdayGachaType,
} from '@/qqbot/plugins/bangDream/policy/gacha.policy';
import { Server } from '@/qqbot/plugins/bangDream/catalog/server.model';
import { Song } from '@/qqbot/plugins/bangDream/song/song.model';
import mainAPI, { waitForMainDataReady } from '@/qqbot/plugins/bangDream/shared/main-data-store';
import {
  fuzzySearch,
  type FuzzySearchResult,
} from '@/qqbot/plugins/bangDream/search/fuzzy-search';
import { drawCardDetail } from '@/qqbot/plugins/bangDream/card/card-detail.renderer';
import { drawCardList } from '@/qqbot/plugins/bangDream/card/card-search.renderer';
import { drawCharacterDetail } from '@/qqbot/plugins/bangDream/character/character-detail.renderer';
import { drawCharacterList } from '@/qqbot/plugins/bangDream/character/character-search.renderer';
import { drawCutoffAll } from '@/qqbot/plugins/bangDream/cutoff/cutoff-all.renderer';
import { drawCutoffDetail } from '@/qqbot/plugins/bangDream/cutoff/cutoff-detail.renderer';
import { drawCutoffEventTop } from '@/qqbot/plugins/bangDream/cutoff/cutoff-event-top.renderer';
import { drawCutoffListOfRecentEvent } from '@/qqbot/plugins/bangDream/cutoff/cutoff-recent.renderer';
import { drawEventDetail } from '@/qqbot/plugins/bangDream/event/event-detail.renderer';
import { drawEventList } from '@/qqbot/plugins/bangDream/event/event-search.renderer';
import { drawEventStage } from '@/qqbot/plugins/bangDream/event/event-stage.renderer';
import { drawGachaDetail } from '@/qqbot/plugins/bangDream/gacha/gacha-detail.renderer';
import { drawRandomGacha } from '@/qqbot/plugins/bangDream/gacha/gacha-simulate.renderer';
import { drawPlayerDetail } from '@/qqbot/plugins/bangDream/player/player-detail.renderer';
import { drawSongChart } from '@/qqbot/plugins/bangDream/song/song-chart.renderer';
import { drawSongDetail } from '@/qqbot/plugins/bangDream/song/song-detail.renderer';
import { drawSongList } from '@/qqbot/plugins/bangDream/song/song-search.renderer';
import { drawSongMetaList } from '@/qqbot/plugins/bangDream/song/song-meta.renderer';
import { drawSongRandom } from '@/qqbot/plugins/bangDream/song/song-random.renderer';
import {
  BangDreamDictionaryLoader,
  type BangDreamDictionaryItem,
} from '@/qqbot/plugins/bangDream/dictionary/dictionary-loader';
import type { QqbotBangDreamOperationHandlerName } from '@/qqbot/plugins/bangDream/registry/operation-registry';
import {
  BANGDREAM_TSUGU_ENV_KEYS,
  normalizeBangDreamBoolean,
  splitBangDreamOptionList,
} from '@/qqbot/plugins/bangDream/config/runtime-options';
import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamCommandOutput,
  QqbotBangDreamOperationKey,
} from '@/qqbot/plugins/bangDream/qqbot-bangdream.types';

const SOURCE_NAME = 'Tsugu BangDream Bot 内置源码';

@Injectable()
export class QqbotBangDreamRendererService {
  private readonly dictionaryLoader = new BangDreamDictionaryLoader();

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    private readonly dictService?: DictService,
  ) {}

  async refreshDictionaryCache() {
    await this.dictionaryLoader.refresh((dictCode) =>
      this.fetchDictionaryItems(dictCode),
    );
  }

  async checkHealth() {
    await waitForMainDataReady();
    const data = mainAPI as { cards?: unknown; songs?: unknown };
    if (!data.songs || !data.cards) {
      throw new Error('Tsugu 数据配置未加载');
    }
    fuzzySearch('夏祭り');
    return true;
  }

  async executeOperationHandler(
    handlerName: QqbotBangDreamOperationHandlerName,
    input: QqbotBangDreamCommandInput,
  ) {
    const handler = this[handlerName];
    if (typeof handler !== 'function') {
      throw new Error(`BangDream 插件能力未绑定执行器：${handlerName}`);
    }
    return await (
      handler as (
        input: QqbotBangDreamCommandInput,
      ) => Promise<QqbotBangDreamCommandOutput>
    ).call(this, input);
  }

  async searchSong(input: QqbotBangDreamCommandInput) {
    const query = this.requireText(input, '请提供歌曲名或歌曲 ID');
    const options = this.getRenderOptions(input);
    const images = this.isInteger(query)
      ? await drawSongDetail(
          new Song(Number(query)),
          options.displayedServerList,
          options.compress,
        )
      : await this.drawFuzzyResult(query, (matches) =>
          drawSongList(matches, options.displayedServerList, options.compress),
        );
    return this.toImageReply('bangdream.song.search', query, images);
  }

  async searchCard(input: QqbotBangDreamCommandInput) {
    const query = this.requireText(input, '请提供卡牌关键词或卡牌 ID');
    const options = this.getRenderOptions(input);
    const images = this.isInteger(query)
      ? await drawCardDetail(
          Number(query),
          options.displayedServerList,
          options.useEasyBG,
          options.compress,
        )
      : await this.drawFuzzyResult(query, (matches) =>
          drawCardList(matches, options.displayedServerList, options.compress),
        );
    return this.toImageReply('bangdream.card.search', query, images);
  }

  async getCardIllustration(input: QqbotBangDreamCommandInput) {
    const cardId = this.requireNumber(
      input.cardId,
      this.firstToken(input),
      '请提供卡牌 ID',
    );
    const card = new Card(cardId);
    if (!card.isExist) {
      return this.toImageReply('bangdream.card.illustration', `${cardId}`, [
        '错误: 该卡不存在',
      ]);
    }

    const images: Array<Buffer | string> = [];
    for (const trainingStatus of card.getTrainingStatusList()) {
      images.push(await card.getCardIllustrationImageBuffer(trainingStatus));
    }
    return this.toImageReply(
      'bangdream.card.illustration',
      `${cardId}`,
      images,
    );
  }

  async searchCharacter(input: QqbotBangDreamCommandInput) {
    const query = this.requireText(input, '请提供角色关键词或角色 ID');
    const options = this.getRenderOptions(input);
    const images = this.isInteger(query)
      ? await drawCharacterDetail(
          Number(query),
          options.displayedServerList,
          options.compress,
        )
      : await this.drawFuzzyResult(query, (matches) =>
          drawCharacterList(
            matches,
            options.displayedServerList,
            options.compress,
          ),
        );
    return this.toImageReply('bangdream.character.search', query, images);
  }

  async searchEvent(input: QqbotBangDreamCommandInput) {
    const query = this.requireText(input, '请提供活动关键词或活动 ID');
    const options = this.getRenderOptions(input);
    const images = this.isInteger(query)
      ? await drawEventDetail(
          Number(query),
          options.displayedServerList,
          options.useEasyBG,
          options.compress,
        )
      : await this.drawFuzzyResult(query, (matches) =>
          drawEventList(matches, options.displayedServerList, options.compress),
        );
    return this.toImageReply('bangdream.event.search', query, images);
  }

  async searchPlayer(input: QqbotBangDreamCommandInput) {
    const tokens = this.getTokens(input);
    const playerId = this.requireNumber(
      input.playerId,
      tokens[0],
      '请提供玩家 ID',
    );
    const server = this.pickMainServer(input, tokens.slice(1));
    const options = this.getRenderOptions(input);
    return this.toImageReply(
      'bangdream.player.search',
      `${playerId}`,
      await drawPlayerDetail(
        playerId,
        server,
        options.useEasyBG,
        options.compress,
      ),
    );
  }

  async getSongChart(input: QqbotBangDreamCommandInput) {
    const tokens = this.getTokens(input);
    const songId = this.requireNumber(input.songId, tokens[0], '请提供歌曲 ID');
    const difficulty = this.pickDifficulty(
      input.difficulty ?? input.difficultyText ?? tokens.slice(1).join(' '),
    );
    const options = this.getRenderOptions(input);
    return this.toImageReply(
      'bangdream.song.chart',
      `${songId}${difficulty === undefined ? '' : ` ${difficulty}`}`,
      await drawSongChart(
        songId,
        difficulty ?? 3,
        options.displayedServerList,
        options.compress,
      ),
    );
  }

  async randomSong(input: QqbotBangDreamCommandInput) {
    const query = this.pickText(input);
    const options = this.getRenderOptions(input);
    const matches = query ? fuzzySearch(query) : {};
    return this.toImageReply(
      'bangdream.song.random',
      query || '随机曲',
      await drawSongRandom(
        matches,
        [options.mainServer],
        true,
        options.compress,
      ),
    );
  }

  async getSongMeta(input: QqbotBangDreamCommandInput) {
    const mainServer = this.pickMainServer(input, this.getTokens(input));
    const options = this.getRenderOptions({ ...input, mainServer });
    return this.toImageReply(
      'bangdream.song.meta',
      Server[mainServer],
      await drawSongMetaList(mainServer, options.compress),
    );
  }

  async getEventStage(input: QqbotBangDreamCommandInput) {
    const tokens = this.getTokens(input).filter((item) => item !== '-m');
    const mainServer = this.pickMainServer(input, tokens);
    const eventId =
      this.optionalNumber(input.eventId) ??
      this.firstNumber(tokens) ??
      getPresentEvent(mainServer).eventId;
    const meta = this.normalizeBoolean(
      input.meta,
      this.getTokens(input).includes('-m'),
    );
    const options = this.getRenderOptions({ ...input, mainServer });
    return this.toImageReply(
      'bangdream.event.stage',
      `${eventId}`,
      await drawEventStage(eventId, mainServer, meta, options.compress),
    );
  }

  async searchGacha(input: QqbotBangDreamCommandInput) {
    const gachaId = this.requireNumber(
      input.gachaId,
      this.firstToken(input),
      '请提供卡池 ID',
    );
    const options = this.getRenderOptions(input);
    return this.toImageReply(
      'bangdream.gacha.search',
      `${gachaId}`,
      await drawGachaDetail(
        gachaId,
        options.displayedServerList,
        options.useEasyBG,
        options.compress,
      ),
    );
  }

  async getCutoffDetail(input: QqbotBangDreamCommandInput) {
    const tokens = this.getTokens(input);
    const tier = this.requireNumber(input.tier, tokens[0], '请提供档位');
    const mainServer = this.pickMainServer(input, tokens.slice(1));
    const eventId =
      this.optionalNumber(input.eventId) ??
      this.firstNumber(tokens.slice(1)) ??
      getPresentEvent(mainServer).eventId;
    const options = this.getRenderOptions({ ...input, mainServer });
    const images =
      tier === 10
        ? await drawCutoffEventTop(eventId, mainServer, options.compress)
        : await drawCutoffDetail(eventId, tier, mainServer, options.compress);
    return this.toImageReply(
      'bangdream.cutoff.detail',
      `${tier} ${eventId}`,
      images,
    );
  }

  async getCutoffAll(input: QqbotBangDreamCommandInput) {
    const tokens = this.getTokens(input);
    const mainServer = this.pickMainServer(input, tokens);
    const eventId =
      this.optionalNumber(input.eventId) ??
      this.firstNumber(tokens) ??
      getPresentEvent(mainServer).eventId;
    const options = this.getRenderOptions({ ...input, mainServer });
    return this.toImageReply(
      'bangdream.cutoff.all',
      `${eventId}`,
      await drawCutoffAll(eventId, mainServer, options.compress),
    );
  }

  async getCutoffRecent(input: QqbotBangDreamCommandInput) {
    const tokens = this.getTokens(input);
    const tier = this.requireNumber(input.tier, tokens[0], '请提供档位');
    const mainServer = this.pickMainServer(input, tokens.slice(1));
    const eventId =
      this.optionalNumber(input.eventId) ??
      this.firstNumber(tokens.slice(1)) ??
      getPresentEvent(mainServer).eventId;
    const options = this.getRenderOptions({ ...input, mainServer });
    return this.toImageReply(
      'bangdream.cutoff.recent',
      `${tier} ${eventId}`,
      await drawCutoffListOfRecentEvent(
        eventId,
        tier,
        mainServer,
        options.compress,
      ),
    );
  }

  async simulateGacha(input: QqbotBangDreamCommandInput) {
    const tokens = this.getTokens(input);
    const mainServer = this.pickMainServer(input, tokens);
    const times =
      this.optionalNumber(input.times) ??
      this.firstNumber(tokens) ??
      BANGDREAM_GACHA_DEFAULT_SPIN_COUNT;
    const gachaId =
      this.optionalNumber(input.gachaId) ?? this.secondNumber(tokens);
    const options = this.getRenderOptions({ ...input, mainServer });
    const gacha = gachaId
      ? new Gacha(gachaId)
      : await this.pickPresentGacha(mainServer);
    return this.toImageReply(
      'bangdream.gacha.simulate',
      `${times}${gachaId ? ` ${gachaId}` : ''}`,
      await drawRandomGacha(gacha, times, options.compress),
    );
  }

  private async pickPresentGacha(mainServer: Server) {
    const gachaList = await getPresentGachaList(mainServer);
    const gacha = gachaList.find((item) => !isBirthdayGachaType(item.type));
    if (!gacha) throw new Error('错误: 该服务器没有正在进行的卡池');
    return gacha;
  }

  private async drawFuzzyResult(
    query: string,
    render: (matches: FuzzySearchResult) => Promise<Array<Buffer | string>>,
  ) {
    const matches = fuzzySearch(query);
    if (Object.keys(matches).length === 0) {
      return ['错误: 没有有效的关键词'];
    }
    return await render(matches);
  }

  private toImageReply(
    operationKey: QqbotBangDreamOperationKey,
    query: string,
    list: Array<Buffer | string>,
  ): QqbotBangDreamCommandOutput {
    const images = list.filter((item): item is Buffer => Buffer.isBuffer(item));
    if (images.length === 0) {
      const message =
        list.find((item): item is string => typeof item === 'string') ||
        'Tsugu 未返回图片';
      throw new Error(message);
    }
    return {
      imageCount: images.length,
      operationKey,
      query,
      replyText: images
        .map((item) => `[CQ:image,file=base64://${item.toString('base64')}]`)
        .join('\n'),
      source: SOURCE_NAME,
    };
  }

  private getRenderOptions(
    input: QqbotBangDreamCommandInput,
    defaults: { useEasyBG?: boolean } = {},
  ) {
    return {
      compress: normalizeBangDreamBoolean(
        input.compress,
        normalizeBangDreamBoolean(
          this.configService.get<string>(BANGDREAM_TSUGU_ENV_KEYS.compress),
          true,
        ),
      ),
      displayedServerList: this.pickDisplayedServerList(input),
      mainServer: this.pickMainServer(input, []),
      useEasyBG: normalizeBangDreamBoolean(
        input.useEasyBG,
        normalizeBangDreamBoolean(
          this.configService.get<string>(BANGDREAM_TSUGU_ENV_KEYS.useEasyBg),
          defaults.useEasyBG ?? false,
        ),
      ),
    };
  }

  private pickDisplayedServerList(input: QqbotBangDreamCommandInput) {
    const source =
      input.displayedServerList ||
      this.configService.get<string>(BANGDREAM_TSUGU_ENV_KEYS.displayedServers);
    const defaultServers = this.dictionaryLoader.getDefaultDisplayedServers();
    if (!source) return defaultServers;
    const values = splitBangDreamOptionList(source);
    const servers = values
      .map((item) => this.normalizeServer(item))
      .filter((item) => item !== undefined) as Server[];
    return servers.length > 0 ? [...new Set(servers)] : defaultServers;
  }

  private pickMainServer(
    input: QqbotBangDreamCommandInput,
    tokens: string[],
  ): Server {
    const explicit = this.firstDefined(
      input.mainServer,
      input.serverName,
      input.server,
      tokens.find((item) => this.normalizeServer(item) !== undefined) ||
        this.configService.get<string>(BANGDREAM_TSUGU_ENV_KEYS.mainServer),
    );
    return this.normalizeServer(explicit) ?? Server.cn;
  }

  private pickDifficulty(value: unknown) {
    const source = `${value || ''}`.trim();
    if (!source) return undefined;
    const numeric = this.optionalNumber(source);
    if (numeric !== undefined) return numeric;
    const alias = this.dictionaryLoader.resolveDifficulty(source);
    if (alias !== undefined) return alias;
    const matched = fuzzySearch(source)?.difficulty?.[0];
    return typeof matched === 'number' ? matched : undefined;
  }

  private normalizeServer(value: unknown): Server | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = `${value}`.trim();
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 4) {
      return numeric as Server;
    }
    const server = this.dictionaryLoader.resolveServer(raw);
    return server === undefined ? undefined : (server as Server);
  }

  private requireText(input: QqbotBangDreamCommandInput, message: string) {
    const text = this.pickText(input);
    if (!text) throw new Error(message);
    return text;
  }

  private pickText(input: QqbotBangDreamCommandInput) {
    return `${input.query || input.text || input.raw || ''}`.trim();
  }

  private getTokens(input: QqbotBangDreamCommandInput) {
    if (Array.isArray(input.args)) {
      return input.args.map((item) => `${item}`.trim()).filter(Boolean);
    }
    return this.pickText(input).split(/\s+/).filter(Boolean);
  }

  private firstToken(input: QqbotBangDreamCommandInput) {
    return this.getTokens(input)[0];
  }

  private requireNumber(explicit: unknown, fallback: unknown, message: string) {
    const value =
      this.optionalNumber(explicit) ?? this.optionalNumber(fallback);
    if (value === undefined) throw new Error(message);
    return value;
  }

  private optionalNumber(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
  }

  private firstNumber(tokens: string[]) {
    return tokens
      .map((item) => this.optionalNumber(item))
      .find((item) => item !== undefined);
  }

  private secondNumber(tokens: string[]) {
    return tokens
      .map((item) => this.optionalNumber(item))
      .filter((item) => item !== undefined)[1];
  }

  private normalizeBoolean(value: unknown, fallback: boolean) {
    return normalizeBangDreamBoolean(value, fallback);
  }

  private isInteger(value: string) {
    return /^(0|[1-9]\d*)$/.test(value);
  }

  private firstDefined(...values: unknown[]) {
    return values.find(
      (value) => value !== undefined && value !== null && value !== '',
    );
  }

  private async fetchDictionaryItems(
    dictCode: string,
  ): Promise<BangDreamDictionaryItem[]> {
    if (!this.dictService) return [];
    const items = await this.dictService.getDictItemsByKey(dictCode);
    return items.map(({ label, value }) => ({
      label,
      value,
    }));
  }
}
