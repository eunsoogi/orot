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
  >;
  registry: LocalEvidenceReferenceRegistry;
}) {
  const original = input.registry.resolve(input.alias);
  if (!original) throw new Error('Tool source is unavailable.');
  const expected = fingerprint(input.snapshot);
  const current = async () => {
    const turns = await input.storage.readToolTurns(input.sessionId);
    for (const turn of turns) {
      if (turn.messageId !== input.messageId) continue;
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
    if (signal.aborted || !(await current()))
      return { status: 'unavailable' as const };
    const source = await input.registry.readSource(input.alias, signal);
    if (signal.aborted || !(await current()))
      return { status: 'unavailable' as const };
    return source;
  };
  return input.registry.add({
    reference: original,
    content: '',
    readSource,
    validate: async signal => (await readSource(signal)).status === 'available',
  });
}
