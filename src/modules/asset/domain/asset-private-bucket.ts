import { BadRequestException } from '@nestjs/common';

export const MEDIA_GOVERNANCE_PRIVATE_BUCKET_DEFAULT =
  'kt-media-governance-private';

/**
 * 校验`bucketName`、`configuredMediaDescriptorBucket`是否满足通用资源存储桶约束，并拒绝不合法输入。
 * @param bucketName - 决定通用资源存储桶内容、边界或目标的 `bucketName` 值。
 * @param configuredMediaDescriptorBucket - 决定通用资源存储桶内容、边界或目标的 `configuredMediaDescriptorBucket` 值；为空时采用 `MEDIA_GOVERNANCE_PRIVATE_BUCKET_DEFAULT` 作为兜底。
 * @returns 通用资源存储桶。
 * @throws 当 `bucketName === privateBucket` 成立时拒绝当前输入并抛出 `BadRequestException`。
 */
export function assertGenericAssetBucket(
  bucketName: string,
  configuredMediaDescriptorBucket?: string,
) {
  const privateBucket =
    configuredMediaDescriptorBucket || MEDIA_GOVERNANCE_PRIVATE_BUCKET_DEFAULT;
  if (bucketName === privateBucket) {
    throw new BadRequestException('该 Bucket 只能通过所属领域服务访问');
  }
  return bucketName;
}
