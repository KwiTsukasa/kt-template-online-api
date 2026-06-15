export type Ff14HttpMethod = 'GET';

export type QqbotFf14DataCenter = {
  name: string;
  region: string;
  worlds: string[];
};

export type QqbotFf14MarketCatalog = {
  dataCenters: QqbotFf14DataCenter[];
  defaultRegion?: string;
  regions: string[];
};

export type QqbotFf14MarketTarget = {
  dataCenter?: string;
  label: string;
  region?: string;
  target: string;
  world?: string;
};

export type QqbotFf14ResolvedItem = {
  icon?: string;
  isUntradable?: boolean;
  itemId: number;
  itemLevel?: number;
  name: string;
};

export type UniversalisListing = {
  hq?: boolean;
  lastReviewTime?: number;
  pricePerUnit?: number;
  quantity?: number;
  retainerName?: string;
  total?: number;
  worldName?: string;
};

export type QqbotFf14PriceResult = {
  averagePrice?: number;
  hq?: boolean;
  item: QqbotFf14ResolvedItem;
  listings: UniversalisListing[];
  minPrice?: number;
  replyText: string;
  updatedAt?: string;
  world: string;
};

export type UniversalisMarketResponse = {
  currentAveragePrice?: number;
  currentAveragePriceHQ?: number;
  currentAveragePriceNQ?: number;
  itemID?: number;
  lastUploadTime?: number;
  listings?: UniversalisListing[];
  minPrice?: number;
  minPriceHQ?: number;
  minPriceNQ?: number;
  worldName?: string;
};

export type XivapiSearchItem = {
  fields?: {
    Icon?: string | { path?: string; path_hr1?: string };
    IsUntradable?: boolean;
    LevelItem?: number | { row_id?: number; value?: number };
    Name?: string;
  };
  id?: number;
  name?: string;
  row_id?: number;
  sheet?: string;
};
