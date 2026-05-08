import {
  Controller,

} from '@nestjs/common';
import { ToolsService } from 'src/utils/tool.service';
import { MinioClientService } from './minio.service';

@Controller('minio')
export class MinioClientController {
  constructor(
    private readonly toolsService: ToolsService,
    private readonly minioClientService: MinioClientService,
  ) {} //注入服务


}
