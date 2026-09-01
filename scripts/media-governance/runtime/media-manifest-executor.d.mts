export interface MediaManifestCollection {
  cloudSidecarQuarantine: { forward: unknown[]; inverse: unknown[] };
  cloudVideo: { forward: unknown[]; inverse: unknown[] };
  local: { forward: unknown[]; inverse: unknown[] };
}

export interface MediaManifestDigests {
  cloudSidecarForward: string;
  cloudSidecarInverse: string;
  cloudVideoForward: string;
  cloudVideoInverse: string;
  localForward: string;
  localInverse: string;
}

export interface LocalMediaExecutorIo {
  digest(path: string, method: string): string;
  ensureParent(path: string): void;
  exists(path: string): boolean;
  isTrimMediaRunning(): boolean;
  link?(source: string, target: string): void;
  nearestExistingDevice(path: string): number;
  rename(source: string, target: string): void;
  stat(path: string): {
    ctimeNs: string;
    dev: number | string;
    ino: number | string;
    isFile: boolean;
    mtimeMs: number;
    mtimeNs: string;
    nlink: number | string;
    size: number;
  };
  verify?(
    path: string,
    method: string,
    onBytes?: (bytes: number) => void,
  ): {
    after: ReturnType<LocalMediaExecutorIo["stat"]>;
    before: ReturnType<LocalMediaExecutorIo["stat"]>;
    digest: string;
  };
}

export interface LocalMediaVerificationProgress {
  cacheHitCount: number;
  completedBytes: number;
  completedItems: number;
  hashedItemCount: number;
  totalBytes: number;
  totalItems: number;
}

export interface LocalMediaVerificationCache {
  attemptId: string;
  matches(path: string, evidence: unknown, stat: unknown): boolean;
  planRoot: string;
  planSha256: string;
  progressPath: string;
  record(path: string, evidence: unknown, stat: unknown): void;
  writeProgress(
    progress: LocalMediaVerificationProgress & {
      direction: "forward" | "inverse";
    },
  ): void;
}

export interface LocalMediaExecutorJournal {
  acquire?(): void;
  append(entry: Record<string, unknown>): void;
  hasCommitted(replayKey: string, direction: "forward" | "inverse"): boolean;
  release?(): void;
}

export interface CloudMediaExecutorIo {
  assertMoveReady?(source: string, target: string): void;
  assertTransport?(): void;
  close?(): void;
  ensureParent?(target: string): void;
  exists(path: string): boolean;
  move(source: string, target: string): void;
  refresh?(): void;
  remove(path: string): void;
  stat(path: string): {
    isFile: boolean;
    mtimeMs: number;
    size: number;
  };
  upload(source: string, target: string, localIo: LocalMediaExecutorIo): void;
}

export interface CloudMediaExecutorProgress {
  completed: number;
  direction: "forward" | "inverse";
  phase: "applying" | "verifying";
  scope: "cloud";
  total: number;
}

export function computeManifestDigests(
  manifests: MediaManifestCollection,
): MediaManifestDigests;

export function createFileVerificationCache(
  cacheRoot: string,
  plan: unknown,
  options?: { attemptId?: string; verifierSha256?: string },
): LocalMediaVerificationCache;

export function executeLocalManifest(
  plan: unknown,
  options: {
    direction: "forward" | "inverse";
    execute: boolean;
    io?: LocalMediaExecutorIo;
    journal?: LocalMediaExecutorJournal;
    onProgress?(event: LocalMediaVerificationProgress): void;
    replacementBackup?: Record<string, unknown>;
    requireVerificationCache?: boolean;
    verificationCache?: LocalMediaVerificationCache;
  },
): {
  cacheHitCount: number;
  completedBytes: number;
  hashedItemCount: number;
  operationCount: number;
  serviceStopped?: boolean;
  state: "committed" | "preflight-passed";
  totalBytes: number;
};

export function executeCloudManifest(
  plan: unknown,
  options: {
    cloudIo?: CloudMediaExecutorIo;
    direction?: "forward" | "inverse";
    execute?: boolean;
    journal?: LocalMediaExecutorJournal;
    localIo?: LocalMediaExecutorIo;
    onProgress?(event: CloudMediaExecutorProgress): void;
    password?: string;
  },
): {
  operationCount: number;
  state: "committed" | "preflight-passed";
};
