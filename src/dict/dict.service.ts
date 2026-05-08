import { Injectable } from '@nestjs/common';
import { ToolsService } from '@/utils/tool.service';
import { ComponentTypeEnum, DictKeyEnum } from '@/utils/constant';

@Injectable()
export class DictService {
  constructor(private readonly toolsService: ToolsService) {}

  async getComponentDictByType(type: ComponentTypeEnum): Promise<Dict[]> {
    switch (type) {
      case ComponentTypeEnum.CHART:
        return this.toolsService.getDictByKey(DictKeyEnum.CHART);

      case ComponentTypeEnum.COMPONENT:
        return this.toolsService.getDictByKey(DictKeyEnum.COMPONENT);

      default:
        return this.toolsService.getDictByKey(DictKeyEnum.CHART);
    }
  }
}
