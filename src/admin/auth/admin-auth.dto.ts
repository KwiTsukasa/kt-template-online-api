import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginDto {
  @ApiProperty({ description: 'RSA-OAEP 加密后的登录密码' })
  encryptedPassword?: string;

  @ApiProperty({ description: '用户名' })
  username?: string;
}

export class AdminPasswordPublicKeyDto {
  @ApiProperty({ description: '加密算法', example: 'RSA-OAEP' })
  algorithm: 'RSA-OAEP';

  @ApiProperty({ description: '摘要算法', example: 'SHA-256' })
  hash: 'SHA-256';

  @ApiProperty({ description: 'PEM 格式 RSA 公钥' })
  publicKey: string;
}
