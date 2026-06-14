import { Injectable } from '@nestjs/common';
import type {
  QqbotBangDreamCommandInput,
  QqbotBangDreamOperationKey,
  QqbotBangDreamSongSearchInput,
  QqbotBangDreamSongSummary,
} from '@/modules/qqbot/plugins/bangDream/qqbot-bangdream.types';
import { TsuguApplicationService } from '@/modules/qqbot/plugins/bangDream/application/bangdream-application.service';

@Injectable()
export class QqbotBangDreamClientService {
  constructor(
    private readonly tsuguApplicationService: TsuguApplicationService,
  ) {}

  async checkHealth() {
    return this.tsuguApplicationService.checkHealth();
  }

  async execute(
    operationKey: QqbotBangDreamOperationKey,
    input: QqbotBangDreamCommandInput,
  ) {
    return await this.tsuguApplicationService.execute(operationKey, input);
  }

  async searchSong(
    params: QqbotBangDreamSongSearchInput,
  ): Promise<QqbotBangDreamSongSummary> {
    return await this.tsuguApplicationService.execute(
      'bangdream.song.search',
      params,
    );
  }
}
