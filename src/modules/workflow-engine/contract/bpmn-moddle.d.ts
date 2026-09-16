declare module 'bpmn-moddle' {
  interface ModdleNode {
    $type: string;
    get: (name: string) => unknown;
    [key: string]: any;
  }
  interface ModdleParseResult {
    rootElement: ModdleNode;
    elementsById: Record<string, ModdleNode>;
    warnings: Array<{ message: string }>;
  }
  const BpmnModdle: new (packages?: Record<string, unknown>) => {
    fromXML: (xml: string) => Promise<ModdleParseResult>;
    toXML: (root: ModdleNode, options?: { format?: boolean }) => Promise<{ xml: string }>;
    create: (type: string, attributes?: Record<string, unknown>) => ModdleNode;
  };
  export = BpmnModdle;
}
