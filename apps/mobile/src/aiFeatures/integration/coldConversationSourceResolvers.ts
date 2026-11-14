import type {
  EvidenceReference,
  ToolSourceReference,
} from '@orot/agent-runtime';
import type {
  LocalEvidenceReferenceRegistry,
  EvidenceSourceReadResult,
} from './evidenceRegistry';
import type { ToolCallScope } from './toolReferenceIndex';

export interface ColdConversationSourceOwner {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly requestId: string;
  readonly operationRunId: string;
}
export type ResolveColdConversationToolSource = (
  owner: ColdConversationSourceOwner,
  reference: ToolSourceReference,
  signal: AbortSignal,
  scope: ToolCallScope,
) => Promise<EvidenceReference | undefined>;
type Registration = {
  readonly owner: ColdConversationSourceOwner;
  readonly registry: LocalEvidenceReferenceRegistry;
  /** Recheck protected session generation/version, request/run ownership and source invalidation. */
  readonly isCurrent: (
    owner: ColdConversationSourceOwner,
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** Verify the persisted call and exact source membership; absent verification disables tool routing. */
  readonly toolSourceIsCurrent?: (
    reference: ToolSourceReference,
    scope: ToolCallScope,
    signal: AbortSignal,
  ) => Promise<boolean>;
};
function key(owner: ColdConversationSourceOwner): string {
  if (
    !owner ||
    !Number.isSafeInteger(owner.sessionVersion) ||
    owner.sessionVersion < 0 ||
    [owner.sessionId, owner.requestId, owner.operationRunId].some(
      value => typeof value !== 'string' || !value.trim(),
    )
  )
    throw new Error('Invalid cold source owner.');
  return JSON.stringify([
    owner.sessionId,
    owner.sessionVersion,
    owner.requestId,
    owner.operationRunId,
  ]);
}
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** Run-local alias routing only. No global fallback and no authority to resume, search or transmit.
 * Retain registrations while their answer is displayed; invalidation fences in-flight reads too. */
export function createColdConversationSourceResolvers() {
  const entries = new Map<string, Registration>();
  async function guarded<T>(
    owner: ColdConversationSourceOwner,
    signal: AbortSignal,
    read: (entry: Registration) => Promise<T>,
  ): Promise<T | undefined> {
    try {
      const id = key(owner),
        entry = entries.get(id);
      if (!entry || signal.aborted) return undefined;
      const current = async () =>
        !signal.aborted &&
        entries.get(id) === entry &&
        (await entry.isCurrent(entry.owner, signal)) &&
        !signal.aborted &&
        entries.get(id) === entry;
      if (!(await current())) return undefined;
      const value = await read(entry);
      return (await current()) ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return {
    register(input: Registration): () => void {
      const id = key(input.owner);
      const entry = { ...input, owner: Object.freeze({ ...input.owner }) };
      entries.set(id, entry);
      // An old screen's cleanup cannot unregister the replacement attempt's readers.
      return () => {
        if (entries.get(id) === entry) entries.delete(id);
      };
    },
    invalidateSession(sessionId: string) {
      for (const [id, entry] of entries)
        if (entry.owner.sessionId === sessionId) entries.delete(id);
    },
    invalidateRequest(sessionId: string, requestId: string) {
      for (const [id, entry] of entries)
        if (
          entry.owner.sessionId === sessionId &&
          entry.owner.requestId === requestId
        )
          entries.delete(id);
    },
    async readSource(
      owner: ColdConversationSourceOwner,
      reference: EvidenceReference,
      signal: AbortSignal,
    ): Promise<EvidenceSourceReadResult> {
      const alias = copy(reference);
      return (
        (await guarded(owner, signal, entry =>
          entry.registry.readSource(alias, signal),
        )) ?? { status: 'unavailable' }
      );
    },
    /** Identity resolution is asynchronous too; never expose stale original identifiers from a cache. */
    async resolveSource(
      owner: ColdConversationSourceOwner,
      reference: EvidenceReference,
      signal: AbortSignal,
    ) {
      const alias = copy(reference);
      return guarded(owner, signal, async entry => {
        if (!(await entry.registry.revalidateEvidence([alias], signal)))
          return undefined;
        return entry.registry.resolve(alias);
      });
    },
    async resolveToolSource(
      owner: ColdConversationSourceOwner,
      reference: ToolSourceReference,
      signal: AbortSignal,
      scope: ToolCallScope,
    ) {
      const source = copy(reference),
        call = copy(scope);
      if (
        call.sessionId !== owner.sessionId ||
        call.operationRunId !== owner.operationRunId ||
        !call.callId
      )
        return undefined;
      return guarded(owner, signal, async entry => {
        const valid = entry.toolSourceIsCurrent;
        if (!valid || !(await valid(source, call, signal)) || signal.aborted)
          return undefined;
        const result = await entry.registry.resolveToolSource(
          source,
          signal,
          call,
        );
        // A call/source deletion during its reader must not complete navigation.
        return result && !signal.aborted && (await valid(source, call, signal))
          ? result
          : undefined;
      });
    },
  };
}
