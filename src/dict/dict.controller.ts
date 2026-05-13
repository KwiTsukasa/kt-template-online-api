import {
  Controller,
  Get,
  HttpStatus,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common';
import { ToolsService } from '@/utils/tool.service';
import { DictService } from './dict.service';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ComponentTypeEnum, DictKeyEnum, DictKeyType } from '@/utils/constant';
import { ApiArrayResponse } from '@/common/swagger-response';
import { DictDto } from './dict.dto';

const componentTypeDictExample = [
  {
    label: '图表',
    value: 1,
  },
  {
    label: '组件',
    value: 2,
  },
];

const chartDictExample = [
  {
    label: '未分类',
    value: -1,
  },
  {
    label: '折线图',
    value: 1,
  },
];

@ApiTags('dict')
@Controller('dict')
export class DictController {
  constructor(
    private readonly toolsService: ToolsService,
    private readonly dictService: DictService,
  ) {} //注入服务

  @ApiOperation({ summary: '根据key获取字典' })
  @ApiQuery({ name: 'dictKey', enum: DictKeyEnum })
  @ApiArrayResponse(DictDto, componentTypeDictExample)
  @Get('getDictByKey')
  async getDictByKey(@Res() res, @Query('dictKey') dictKey: DictKeyType) {
    const dict = this.toolsService.getDictByKey(dictKey);

    return res.send(this.toolsService.res(HttpStatus.OK, '操作成功', dict));
  }

  @ApiOperation({ summary: '根据组件类型获取组件字典' })
  @ApiQuery({ name: 'type', enum: ComponentTypeEnum })
  @ApiArrayResponse(DictDto, chartDictExample)
  @Get('getComponentDictByType')
  async getComponentDictByType(@Res() res, @Query('type', ParseIntPipe) type) {
    const dict = await this.dictService.getComponentDictByType(type);

    return res.send(this.toolsService.res(HttpStatus.OK, '操作成功', dict));
  }
}
