import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QqbotDedupe } from '../../infrastructure/persistence/dedupe/qqbot-dedupe.entity';

@Injectable()
export class QqbotDedupeService {
  constructor(
    @InjectRepository(QqbotDedupe)
    private readonly dedupeRepository: Repository<QqbotDedupe>,
  ) {}

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
