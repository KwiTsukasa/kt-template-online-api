import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessTaskRegistration } from './business-task.registration';
import { businessTaskDefaults } from './business-task.defaults';
import { DefaultPlanProvisioner } from './default-plan.provisioner';

@Injectable()
export class BusinessPlanBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(BusinessPlanBootstrap.name);
  constructor(
    private readonly config: ConfigService,
    private readonly registration: BusinessTaskRegistration,
    private readonly plans: DefaultPlanProvisioner,
  ) {}

  async onApplicationBootstrap() {
    const handlers = new Map(
      this.registration.declarations().map((handler) => [handler.key, handler]),
    );
    for (const item of businessTaskDefaults(this.config)) {
      const handler = handlers.get(item.key)!;
      if (!(await handler.isAvailable())) {
        this.logger.warn(`业务能力 ${item.key} 当前不可用，保留其已有计划`);
        continue;
      }
      await this.plans.ensure({
        sourceKey: 'system:' + item.key,
        name: item.name,
        description: item.description,
        handler,
        trigger: { type: 'interval', everyMs: item.intervalMs },
        enabled: item.enabled,
      });
    }
  }
}
