export type FuzzySearchMatchValue = string | number;

export type FuzzySearchConfigValue =
  | FuzzySearchMatchValue
  | FuzzySearchMatchValue[]
  | Record<string, unknown>;

export interface FuzzySearchConfig {
  [type: string]: { [key: string]: FuzzySearchConfigValue[] };
}

export interface FuzzySearchResult {
  [key: string]: FuzzySearchMatchValue[];
}

export type FuzzySearchResultWriter = (
  key: string,
) => (value: FuzzySearchMatchValue) => void;
