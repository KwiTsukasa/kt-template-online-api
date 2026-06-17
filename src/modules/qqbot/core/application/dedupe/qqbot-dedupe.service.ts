import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QqbotDedupe } from '../../infrastructure/persistence/dedupe/qqbot-dedupe.entity';

@Injectable()
export class QqbotDedupeService {
  /**
   * 初始化 QqbotDedupeService 实例。
   * @param dedupeRepository - QQBot仓库依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(QqbotDedupe)
    private readonly dedupeRepository: Repository<QqbotDedupe>,
  ) {}

  /**
   * 执行 QQBot 核心流程。
   * @param eventKey - eventKey 输入；影响 claim 的返回值。
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
