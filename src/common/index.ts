export function DecodeDictKey(dict: Dict[]): PropertyDecorator {
  return (target, key: string | symbol) => {
    Reflect.defineProperty(target, `_${key.toString()}`, {
      set(newVal) {
        this[key] = dict.find((i) => i.value == newVal).label;
      },
    });
  };
}
