/** A single validation operation can share a load, never a result across operations. */
export interface EvidenceValidationContext {
  once<T>(key: object, load: () => Promise<T>): Promise<T>;
}
export function validationContext(): EvidenceValidationContext {
  const loads = new Map<object, Promise<unknown>>();
  return {
    once<T>(key: object, load: () => Promise<T>): Promise<T> {
      let result = loads.get(key) as Promise<T> | undefined;
      if (!result) {
        result = Promise.resolve().then(load);
        loads.set(key, result);
      }
      return result;
    },
  };
}
