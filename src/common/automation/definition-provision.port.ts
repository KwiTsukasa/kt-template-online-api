import type { DefinitionDocument, DefinitionWrite } from './definition.types';

export type DefinitionProvision<T> = DefinitionWrite<T> & {
  sourceKey: string;
  preferredId?: string;
};
export interface DefinitionProvisionPort<T> {
  provision: (input: DefinitionProvision<T>) => Promise<{
    document: DefinitionDocument<T>;
    created: boolean;
  }>;
}
