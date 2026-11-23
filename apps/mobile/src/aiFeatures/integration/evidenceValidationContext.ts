import type { EvidenceChunk } from '@orot/rag';
import type { EvidenceRecordIdentity } from '../../healthEvidence/currentEvidenceChunks';

export type ReadValidationChunks = (
  identities: readonly EvidenceRecordIdentity[],
  signal: AbortSignal,
) => Promise<readonly EvidenceChunk[]>;

/** A single validation operation can share a load, never a result across operations. */
export interface EvidenceValidationContext {
  once<T>(key: object, load: () => Promise<T>): Promise<T>;
  readSelectedChunks?(
    reader: ReadValidationChunks,
    identity: EvidenceRecordIdentity,
    signal: AbortSignal,
  ): Promise<readonly EvidenceChunk[]> | undefined;
}

type Validator = (
  signal: AbortSignal,
  context: EvidenceValidationContext,
) => Promise<boolean>;
const owned = new WeakMap<
  Validator,
  {
    reader: ReadValidationChunks;
    identity: EvidenceRecordIdentity;
  }
>();
const keyFor = ({ kind, id }: EvidenceRecordIdentity) =>
  JSON.stringify([kind, id]);

/** Internal validator metadata, never persisted or projected as evidence. */
export function bindExactReproof(
  validator: Validator,
  reader: ReadValidationChunks,
  identity: EvidenceRecordIdentity,
): Validator {
  owned.set(validator, { reader, identity });
  return validator;
}

export function validationContext(
  validators: readonly (Validator | undefined)[] = [],
): EvidenceValidationContext {
  const selections = new Map<
    ReadValidationChunks,
    Map<string, EvidenceRecordIdentity>
  >();
  for (const validator of validators) {
    const plan = validator && owned.get(validator);
    if (!plan) continue;
    const identities =
      selections.get(plan.reader) ?? new Map<string, EvidenceRecordIdentity>();
    identities.set(keyFor(plan.identity), plan.identity);
    selections.set(plan.reader, identities);
  }
  const loads = new Map<object, Promise<unknown>>();
  const context: EvidenceValidationContext = {
    once<T>(key: object, load: () => Promise<T>): Promise<T> {
      let result = loads.get(key) as Promise<T> | undefined;
      if (!result) {
        result = Promise.resolve().then(load);
        loads.set(key, result);
      }
      return result;
    },
    readSelectedChunks(reader, identity, signal) {
      const identities = selections.get(reader);
      if (!identities?.has(keyFor(identity))) return;
      return context.once(reader, () =>
        reader([...identities.values()], signal),
      );
    },
  };
  return context;
}
