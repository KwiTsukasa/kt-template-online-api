export type NatmapPortPluginHost = {
  resolveNatmapEndpoint: (input: { selector: string }) => Promise<unknown>;
};
