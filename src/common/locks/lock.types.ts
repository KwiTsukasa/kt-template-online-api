export type LockResult<T> = { acquired: false } | { acquired: true; value: T };

export interface LockLease {
  readonly name: string;
  isOwned: () => Promise<boolean>;
}
