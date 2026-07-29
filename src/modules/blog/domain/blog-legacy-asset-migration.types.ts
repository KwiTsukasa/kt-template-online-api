export type BlogLegacyAssetMigrationMode =
  | 'dry-run'
  | 'execute'
  | 'resume'
  | 'rollback'
  | 'verify';

export type BlogLegacyAssetMigrationEntryStatus =
  | 'completed'
  | 'failed'
  | 'planned'
  | 'rolled-back'
  | 'verified';

export type BlogLegacyAssetMigrationField =
  | 'config'
  | 'content_html'
  | 'content_markdown'
  | 'cover'
  | 'excerpt';

export type BlogLegacyAssetMigrationTable =
  | 'blog_article'
  | 'blog_theme_config';

export type BlogLegacyAssetMigrationEntry = {
  basename: string;
  contentSha256: string;
  field: BlogLegacyAssetMigrationField;
  mimeType: string;
  objectKey: string;
  oldUrl: string;
  publicUrl: string;
  rowId: string;
  size: number;
  status: BlogLegacyAssetMigrationEntryStatus;
  table: BlogLegacyAssetMigrationTable;
};

export type BlogLegacyAssetMigrationManifest = {
  createdAt: string;
  entries: BlogLegacyAssetMigrationEntry[];
  mode: BlogLegacyAssetMigrationMode;
  status: 'completed' | 'failed' | 'planned' | 'rolled-back' | 'verified';
  updatedAt: string;
  version: 1;
};

export type BlogLegacyAssetMigrationOptions = {
  backupPath?: string;
  databaseIdentity?: string;
  maintenanceConfirmed?: boolean;
  manifestPath: string;
  mode: BlogLegacyAssetMigrationMode;
};

export type BlogLegacyAssetMigrationManifestStore = {
  assertPath(path: string): void;
  exists(path: string): boolean;
  read(path: string): Promise<BlogLegacyAssetMigrationManifest>;
  write(
    path: string,
    manifest: BlogLegacyAssetMigrationManifest,
  ): Promise<void>;
};

export type BlogLegacyAssetFetchedObject = {
  buffer: Buffer;
  finalUrl: string;
  mimeType: string;
};
