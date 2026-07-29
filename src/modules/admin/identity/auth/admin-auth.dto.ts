import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginDto {
  @ApiProperty({ description: '登录密码，仅允许通过受信任的 TLS 入口提交' })
  password?: string;

  @ApiProperty({ description: '用户名' })
  username?: string;
}
