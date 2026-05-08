import { Injectable } from '@nestjs/common';

import { ToolsService } from 'src/utils/tool.service';
@Injectable()
export class MinioClientService {
  constructor(
    private readonly toolsService: ToolsService,
  ) {}


}
