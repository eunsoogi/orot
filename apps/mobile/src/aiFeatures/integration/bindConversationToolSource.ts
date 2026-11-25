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
  const current = async (signal: AbortSignal) => {
    const timing = sourceOpenTiming(signal);
    const type = (original.locator as { type?: unknown } | null)?.type;
    const exact =
      original.sourceKind === 'generated_artifact' &&
      (type === 'research_publication' ||
        type === 'research_web_explanation') &&
      input.storage.readToolCall;
    const identity = [
      input.sessionId,
      input.runId,
      input.callId,
      input.messageId,
    ] as const;
    const turns = exact
      ? [
          timing
            ? await exact.call(input.storage, ...identity, timing)
            : await exact.call(input.storage, ...identity),
        ]
      : timing
        ? await input.storage.readToolTurns(
            input.sessionId,
            undefined,
            undefined,
            timing,
          )
        : await input.storage.readToolTurns(input.sessionId);
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
  const readSource = async (signal: AbortSignal) => {
    if (signal.aborted || !(await current(signal)))
      return { status: 'unavailable' as const };
    const source = await input.registry.readSource(input.alias, signal);
    if (signal.aborted || !(await current(signal)))
      return { status: 'unavailable' as const };
    return source;
  };
  return input.registry.add({
    reference: original,
    capture: conversationToolCapture(input),
    content: '',
    readSource,
    validate: async signal => (await readSource(signal)).status === 'available',
  });
}
