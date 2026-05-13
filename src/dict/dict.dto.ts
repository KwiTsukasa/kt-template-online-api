import { ApiProperty } from '@nestjs/swagger';

export class DictDto {
  @ApiProperty({
    example: '图表',
  })
  label: string;

  @ApiProperty({
    example: 1,
  })
  value: number;
}
