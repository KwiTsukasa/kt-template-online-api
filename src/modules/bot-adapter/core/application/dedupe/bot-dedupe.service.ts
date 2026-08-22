import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotDedupe } from '../../infrastructure/persistence/dedupe/bot-dedupe.entity';

@Injectable()
export class BotDedupeService {
  constructor(
    @InjectRepository(BotDedupe)
    private readonly dedupeRepository: Repository<BotDedupe>,
  ) {}

  /**
   * 根据`eventKey`处理claim；把变更持久化到当前存储（`dedupeRepository.save`）。
   * @param eventKey - 用于读取或更新claim的稳定键。
   * @returns 满足claim约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async claim(eventKey: string) {
    const exists = await this.dedupeRepository.findOne({
      where: {
        eventKey,
      },
    });
    if (exists) return false;

    try {
      await this.dedupeRepository.save(
        this.dedupeRepository.create({
          eventKey,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
