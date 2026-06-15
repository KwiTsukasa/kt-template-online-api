import type { BangDreamCatalogKey } from '@/modules/qqbot/plugins/bangdream/src/application/catalog/bangdream-catalog-cache';

export const BANGDREAM_BAND_CATALOG_KEYS = [
  'singer',
  'bands',
  'characters',
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_SONG_CATALOG_KEYS = [
  'songs',
  'meta',
  ...BANGDREAM_BAND_CATALOG_KEYS,
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_SONG_SEARCH_CATALOG_KEYS = [
  ...BANGDREAM_SONG_CATALOG_KEYS,
  'events',
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_CARD_ILLUSTRATION_CATALOG_KEYS = [
  'cards',
  'skills',
  'characters',
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_CARD_CATALOG_KEYS = [
  ...BANGDREAM_CARD_ILLUSTRATION_CATALOG_KEYS,
  'singer',
  'bands',
  'events',
  'gacha',
  'costumes',
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_CHARACTER_CATALOG_KEYS = [
  'characters',
  'singer',
  'bands',
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_EVENT_CATALOG_KEYS = [
  'events',
  'characters',
  'singer',
  'bands',
  'cards',
  'skills',
  'gacha',
  'songs',
  'meta',
  'degrees',
  'deco',
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_EVENT_STAGE_CATALOG_KEYS = [
  'events',
  'characters',
  'songs',
  'meta',
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_GACHA_CATALOG_KEYS = [
  'gacha',
  'cards',
  'skills',
  'characters',
  'singer',
  'bands',
  'events',
  'items',
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_GACHA_SIMULATE_CATALOG_KEYS = [
  'gacha',
  'cards',
  'skills',
  'characters',
  'singer',
  'bands',
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_CUTOFF_BASE_CATALOG_KEYS = [
  'events',
  'characters',
  'rates',
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_CUTOFF_DETAIL_CATALOG_KEYS = [
  ...BANGDREAM_CUTOFF_BASE_CATALOG_KEYS,
  'cards',
  'skills',
  'singer',
  'bands',
  'degrees',
] as const satisfies readonly BangDreamCatalogKey[];

export const BANGDREAM_PLAYER_CATALOG_KEYS = [
  'cards',
  'skills',
  'characters',
  'singer',
  'bands',
  'degrees',
  'areaItems',
] as const satisfies readonly BangDreamCatalogKey[];
