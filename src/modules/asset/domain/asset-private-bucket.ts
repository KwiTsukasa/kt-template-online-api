import { BadRequestException } from '@nestjs/common';

export const MEDIA_GOVERNANCE_PRIVATE_BUCKET_DEFAULT =
  'kt-media-governance-private';

/**
 * 阻止通用资源入口访问媒体治理和Bot聊天的私有桶，避免绕过所属领域权限。
 * @param bucketName - 通用资源请求指定的存储桶。
 * @param configuredMediaDescriptorBucket - 媒体治理配置的私有桶；省略时使用默认私有桶。
 * @returns 通过领域边界检查的通用存储桶名称。
 * @throws 请求指定任一受保护私有桶时拒绝访问。
 */
export function assertGenericAssetBucket(
  bucketName: string,
  configuredMediaDescriptorBucket?: string,
) {
  const privateBucket =
    configuredMediaDescriptorBucket || MEDIA_GOVERNANCE_PRIVATE_BUCKET_DEFAULT;
  if (
    bucketName === privateBucket ||
    bucketName === 'kt-bot-artifacts-private'
  ) {
    throw new BadRequestException('该 Bucket 只能通过所属领域服务访问');
  }
  return bucketName;
}
