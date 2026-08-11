import { BadRequestException } from '@nestjs/common';

export const MEDIA_GOVERNANCE_PRIVATE_BUCKET_DEFAULT =
  'kt-media-governance-private';

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
