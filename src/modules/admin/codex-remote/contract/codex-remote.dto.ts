import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class CodexRemoteSessionDto {
  @ApiProperty({ description: '节点声明的项目标识' })
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{0,31}$/)
  projectId: string;
}

