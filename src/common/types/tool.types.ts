export type NapcatLoginStatusLike = {
  isOffline?: boolean;
  loginError?: string;
};

export type QrcodeLookupOptions = {
  requireFresh?: boolean;
  staleQrcode?: string;
};
