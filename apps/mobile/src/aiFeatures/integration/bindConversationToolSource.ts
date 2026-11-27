import {
  isOwnedConversationToolReader,
  isOwnedConversationToolCallReader,
} from '../../storage/conversationToolEventStorage';
import { registerBoundToolRead } from './verifiedBoundToolRead';
import { sourceOpenTiming } from '../../providers/sourceOpenDiagnostic';
import { conversationToolCapture } from './conversationToolCaptureBatch';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { fingerprint } from './evidenceUtils';

/** Reopened links stop resolving when their owning call or session is removed. */
export function bindConversationToolSource(input: {
  alias: EvidenceReference;
  sessionId: string;
  messageId: string;
  runId: string;
  callId: string;
  snapshot: unknown;
  storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'readToolTurns'
  > &
    Partial<
      Pick<ReturnType<typeof createConversationArtifactStorage>, 'readToolCall'>
    >;
  registry: LocalEvidenceReferenceRegistry;
}) {
  const original = input.registry.resolve(input.alias);
  if (!original) throw new Error('Tool source is unavailable.');
  const expected = fingerprint(input.snapshot);
  const current = async (
    signal: AbortSignal,
    storage: typeof input.storage,
  ) => {
    const timing = sourceOpenTiming(signal);
    const type = (original.locator as { type?: unknown } | null)?.type;
    const exact =
      original.sourceKind === 'generated_artifact' &&
      (type === 'research_publication' ||
        type === 'research_web_explanation') &&
      storage.readToolCall;
    const identity = [
      input.sessionId,
      input.runId,
      input.callId,
      input.messageId,
    ] as const;
    const turns = exact
      ? [await exact.call(storage, ...identity, timing, signal)]
      : await storage.readToolTurns(
          input.sessionId,
          undefined,
          // Check every sibling in the owning turn, but don't hydrate other
          // messages on each side of this selected source read.
          [input.messageId],
          timing,
          signal,
        );
    if (signal.aborted) return false;
    for (const turn of turns) {
      if (turn?.messageId !== input.messageId) continue;
      const event = turn.toolEvents.find(
        value =>
          value.operationRunId === input.runId && value.callId === input.callId,
      );
      const lineage = turn.lineages.find(
        value => value.runId === input.runId && value.callId === input.callId,
      );
      if (event && lineage) return fingerprint({ event, lineage }) === expected;
    }
    return false;
  };
  const readWithProof = async (
    signal: AbortSignal,
    storage: typeof input.storage,
    read: LocalEvidenceReferenceRegistry['readSource'],
  ) => {
    if (signal.aborted || !(await current(signal, storage)))
      return { status: 'unavailable' as const };
    const source = await read.call(input.registry, input.alias, signal);
    if (signal.aborted || !(await current(signal, storage)))
      return { status: 'unavailable' as const };
    return source;
  };
  const readSource = (signal: AbortSignal) =>
    readWithProof(signal, input.storage, input.registry.readSource);
  const bound = input.registry.add({
    reference: original,
    capture: conversationToolCapture(input),
    content: '',
    readSource,
    validate: async signal => (await readSource(signal)).status === 'available',
  });
  const wholeTurn = input.storage.readToolTurns;
  const call = input.storage.readToolCall;
  const registryRead = input.registry.readSource;
  const verifiedRead = (signal: AbortSignal) =>
    readWithProof(
      signal,
      {
        readToolTurns: wholeTurn.bind(input.storage),
        ...(call ? { readToolCall: call.bind(input.storage) } : {}),
      },
      registryRead,
    );
  const type = (original.locator as { type?: unknown } | null)?.type;
  if (
    original.sourceKind === 'generated_artifact' &&
    type === 'research_web_explanation' &&
    isOwnedConversationToolCallReader(call)
  )
    registerBoundToolRead(input.registry, bound, {
      kind: 'public-web',
      current: () => input.storage.readToolCall === call,
      read: verifiedRead,
    });
  else if (
    original.sourceKind === 'personal_record' &&
    isOwnedConversationToolReader(wholeTurn)
  )
    registerBoundToolRead(input.registry, bound, {
      kind: 'personal',
      current: () => input.storage.readToolTurns === wholeTurn,
      read: verifiedRead,
    });
  return bound;
}
