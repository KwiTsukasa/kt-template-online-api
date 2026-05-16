import { ApiProperty } from '@nestjs/swagger';

export class DictDto {
  @ApiProperty({
    example: 'COMPONENT_TYPE',
    required: false,
  })
  dictCode?: string;

  @ApiProperty({
    example: '图表',
  })
  label: string;

  @ApiProperty({
    example: 1,
  })
  value: number;
}
