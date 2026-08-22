import { ApiProperty } from '@nestjs/swagger';

export class NapcatRuntimeDetailQueryDto {
  @ApiProperty()
  accountId: string;
}
