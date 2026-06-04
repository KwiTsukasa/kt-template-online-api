export type DecodeDictKeyOptions = {
  fallback?: string;
  sourceKey?: string;
  targetKey?: string;
};

export type DictDecodeRule = DecodeDictKeyOptions & {
  targetKey: string;
  dictKeys: string[];
};
