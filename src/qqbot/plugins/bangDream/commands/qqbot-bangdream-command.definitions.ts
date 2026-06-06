import {
  BANGDREAM_OPERATION_REGISTRY,
  type QqbotBangDreamOperationKey,
} from '../tsugu/runtime/operation-registry';

export const BANGDREAM_INPUT_SCHEMA = {
  properties: {
    args: { description: '命令参数数组', type: 'array' },
    query: { description: '查询关键词', type: 'string' },
    raw: { description: '命令原始参数', type: 'string' },
    text: { description: '命令原始文本', type: 'string' },
  },
  type: 'object',
};

export const BANGDREAM_OUTPUT_SCHEMA = {
  properties: {
    imageCount: { type: 'number' },
    operationKey: { type: 'string' },
    query: { type: 'string' },
    replyText: { type: 'string' },
    source: { type: 'string' },
  },
  type: 'object',
};

export const BANGDREAM_OPERATION_DEFS: Array<{
  description: string;
  key: QqbotBangDreamOperationKey;
  name: string;
}> = BANGDREAM_OPERATION_REGISTRY.map((operation) => ({
  description: operation.description,
  key: operation.key,
  name: operation.name,
}));
