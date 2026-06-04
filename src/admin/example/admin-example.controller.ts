import {
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public, vbenPage, vbenSuccess } from '@/common';
import { MinioClientService } from '@/minio/minio.service';
import type { MinioUploadFile } from '@/minio/minio.types';
import type { AdminDemoTableRow } from '../admin.types';

const DEMO_ROWS: AdminDemoTableRow[] = Array.from(
  { length: 100 },
  (_, index) => {
    const sequence = index + 1;
    const categories = ['Dashboard', 'Form', 'Table', 'Chart', 'Workflow'];
    const colors = ['Blue', 'Green', 'Purple', 'Orange', 'Slate'];
    const statuses = ['success', 'warning', 'error'];

    return {
      available: sequence % 3 !== 0,
      category: categories[index % categories.length],
      color: colors[index % colors.length],
      currency: 'CNY',
      description: `真实 API 示例数据 ${sequence}`,
      id: `demo-${String(sequence).padStart(3, '0')}`,
      imageUrl:
        'https://unpkg.com/@vbenjs/static-source@0.1.7/source/logo-v1.webp',
      imageUrl2:
        'https://unpkg.com/@vbenjs/static-source@0.1.7/source/avatar-v1.webp',
      inProduction: sequence % 2 === 0,
      open: sequence % 4 === 0,
      price: `${(sequence * 3.6 + 19).toFixed(2)}`,
      productName: `KT Admin 模板能力 ${sequence}`,
      quantity: 10 + sequence,
      rating: Number((3 + (sequence % 20) / 10).toFixed(1)),
      releaseDate: new Date(2026, index % 12, (index % 28) + 1).toISOString(),
      status: statuses[index % statuses.length],
      tags: [
        'kt',
        'admin',
        categories[index % categories.length].toLowerCase(),
      ],
      weight: Number((1 + sequence / 10).toFixed(2)),
    };
  },
);

@ApiTags('Admin - 示例')
@Controller()
@UseGuards(JwtAuthGuard)
export class AdminExampleController {
  constructor(private readonly minioClientService: MinioClientService) {}

  @Post('upload')
  @ApiOperation({ summary: '上传示例文件' })
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: MinioUploadFile) {
    const result = await this.minioClientService.uploadObject({ file });

    return vbenSuccess({
      url: result.url,
    });
  }

  @Get('table/list')
  @ApiOperation({ summary: '获取示例表格分页列表' })
  async tableList(@Query() query: Record<string, any>) {
    const page = Math.max(Number(query.page || 1), 1);
    const pageSize = Math.max(Number(query.pageSize || 10), 1);
    const sorted = this.sortRows([...DEMO_ROWS], query.sortBy, query.sortOrder);
    const items = sorted.slice((page - 1) * pageSize, page * pageSize);

    return vbenPage(items, sorted.length);
  }

  @Get('status')
  @ApiOperation({ summary: '返回指定状态码示例' })
  @Public()
  status(@Query('status') status: string, @Res() res: Response) {
    const code = Number(status) || 200;

    if (code === 200) {
      res.status(code).send(vbenSuccess(`${code}`));
      return;
    }

    res.status(code).send({
      code,
      msg: `${code}`,
      err: `${code}`,
    });
  }

  @Get('demo/bigint')
  @ApiOperation({ summary: '获取 BigInt 序列化示例' })
  async bigint(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/json');
    res.send(`{
  "code": 200,
  "msg": "操作成功",
  "data": [
    {
      "id": 123456789012345678901234567890123456789012345678901234567890,
      "name": "John Doe",
      "age": 30,
      "email": "john-doe@demo.com"
    },
    {
      "id": 987654321098765432109876543210987654321098765432109876543210,
      "name": "Jane Smith",
      "age": 25,
      "email": "jane@demo.com"
    }
  ]
}`);
  }

  @Get('test')
  @ApiOperation({ summary: 'GET 测试接口' })
  @Public()
  testGet() {
    return vbenSuccess('Test get handler');
  }

  @Post('test')
  @ApiOperation({ summary: 'POST 测试接口' })
  @Public()
  testPost() {
    return vbenSuccess('Test post handler');
  }

  private sortRows(
    rows: AdminDemoTableRow[],
    sortBy?: string,
    sortOrder?: string,
  ) {
    if (!sortBy || !Object.hasOwn(rows[0], sortBy)) return rows;

    return rows.sort((prev, next) => {
      const prevValue = prev[sortBy];
      const nextValue = next[sortBy];
      const result = String(prevValue).localeCompare(
        String(nextValue),
        'zh-CN',
        {
          numeric: true,
          sensitivity: 'base',
        },
      );

      return sortOrder === 'desc' ? -result : result;
    });
  }
}
