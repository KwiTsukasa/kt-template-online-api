export type BilibiliVideoReference =
  | {
      canonicalVideoId: string;
      kind: 'bvid';
      sourceUrl: string;
      value: string;
    }
  | {
      canonicalVideoId: string;
      kind: 'aid';
      sourceUrl: string;
      value: string;
    };
