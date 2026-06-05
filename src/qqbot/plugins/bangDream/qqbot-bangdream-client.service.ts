import { Injectable } from '@nestjs/common';
import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamOperationKey,
  QqbotBangDreamSongSearchInput,
  QqbotBangDreamSongSummary,
} from './qqbot-bangdream.types';
import { QqbotBangDreamRendererService } from './renderer/qqbot-bangdream-renderer.service';

@Injectable()
export class QqbotBangDreamClientService {
  constructor(
    private readonly rendererService: QqbotBangDreamRendererService,
  ) {}

  async checkHealth() {
    return this.rendererService.checkHealth();
  }

  async execute(
    operationKey: QqbotBangDreamOperationKey,
    input: QqbotBangDreamCommandInput,
  ) {
    return await this.rendererService.execute(operationKey, input);
  }

  async searchSong(
    params: QqbotBangDreamSongSearchInput,
  ): Promise<QqbotBangDreamSongSummary> {
    return await this.rendererService.execute('bangdream.song.search', params);
  }
}
