export type FflogsCharacter = {
  id?: number;
  lodestoneID?: number;
  name?: string;
  recentReports?: {
    data?: FflogsRecentReport[];
  };
  server?: {
    name?: string;
    slug?: string;
  };
  zoneRankings?: unknown;
};

export type FflogsCharacterSummaryResponse = {
  characterData?: {
    character?: FflogsCharacter | null;
  };
};

export type FflogsCharacterEncounterRankingsResponse = {
  characterData?: {
    character?:
      | (FflogsCharacter & {
          dpsRankings?: unknown;
          hpsRankings?: unknown;
        })
      | null;
  };
};

export type FflogsEncounterFightCandidate = {
  absoluteStartTime: number;
  fight: FflogsReportFight;
  report: FflogsRecentReport;
};

export type FflogsEncounterLookup = {
  displayName: string;
  encounterId?: number;
  input: string;
  keys: string[];
  zoneId?: number;
};

export type FflogsGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

export type FflogsHttpMethod = 'GET' | 'POST';

export type FflogsLocalizationKey = 'job' | 'metric' | 'role' | 'serverRegion';

export type FflogsLocalizationMaps = Record<
  FflogsLocalizationKey,
  Map<string, string>
>;

export type FflogsParseMetric = {
  amount?: number;
  color: string;
  percent?: number;
  rank?: string;
};

export type FflogsRankingItem = Record<string, any>;

export type FflogsRecentReport = {
  code?: string;
  endTime?: number;
  fights?: FflogsReportFight[];
  startTime?: number;
  title?: string;
  zone?: {
    id?: number;
    name?: string;
  };
};

export type FflogsReportFight = {
  difficulty?: number | null;
  encounterID?: number;
  endTime?: number;
  id?: number;
  kill?: boolean | null;
  name?: string;
  startTime?: number;
};

export type FflogsReportFightMetricsResponse = {
  reportData?: {
    report?: {
      damage?: unknown;
      dpsRankings?: unknown;
      healing?: unknown;
      hpsRankings?: unknown;
    } | null;
  };
};

export type FflogsTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
};

export type FflogsCharacterSummaryInput = {
  character?: string;
  characterName?: string;
  className?: string;
  difficulty?: number | string;
  encounter?: string;
  encounterName?: string;
  limit?: number | string;
  metric?: string;
  partition?: number | string;
  reportsLimit?: number | string;
  role?: string;
  server?: string;
  serverRegion?: string;
  serverSlug?: string;
  size?: number | string;
  specName?: string;
  timeframe?: string;
  zoneId?: number | string;
};

export type FflogsCharacterSummaryResult = {
  allStarText?: string;
  characterId?: number;
  characterName: string;
  encounterName?: string;
  encounterSuggestions?: string[];
  logs?: FflogsEncounterLogItem[];
  rankingSuggestions?: string[];
  rankings: FflogsRankingItem[];
  replyText: string;
  serverName: string;
  serverRegion: string;
  url: string;
};

export type FflogsEncounterLogItem = {
  adps?: number;
  color: string;
  damageScore?: number;
  dps?: number;
  durationMs?: number;
  encounterName: string;
  fightId?: number;
  healingColor: string;
  healingScore?: number;
  hps?: number;
  kill?: boolean | null;
  logCode: string;
  logUrl: string;
  ndps?: number;
  rdps?: number;
  reportTitle?: string;
  startTime?: number;
};
