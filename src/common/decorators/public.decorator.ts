import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 执行 当前模块流程。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
