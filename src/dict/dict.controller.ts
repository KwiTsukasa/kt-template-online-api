import {
  Controller,
  Get,
  HttpStatus,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common';
import { DictService } from './dict.service';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiArrayResponse, ToolsService } from '@/common';
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
  ) {}

  @ApiOperation({ summary: '根据key获取字典' })
  @ApiQuery({ name: 'dictKey', type: String })
  @ApiArrayResponse(DictDto, componentTypeDictExample)
  @Get('getDictByKey')
  async getDictByKey(@Res() res, @Query('dictKey') dictKey: string) {
    const dict = await this.dictService.getDictByKey(dictKey);

    return res.send(this.toolsService.res(HttpStatus.OK, '操作成功', dict));
  }

  @ApiOperation({ summary: '根据组件类型获取组件字典' })
  @ApiQuery({ name: 'type', type: Number })
  @ApiArrayResponse(DictDto, chartDictExample)
  @Get('getComponentDictByType')
  async getComponentDictByType(@Res() res, @Query('type', ParseIntPipe) type) {
    const dict = await this.dictService.getComponentDictByType(type);

    return res.send(this.toolsService.res(HttpStatus.OK, '操作成功', dict));
  }
}
