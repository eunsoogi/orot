import type { EvidenceReference } from '@orot/agent-runtime';
import type { RagConversationMessage } from '../../ragConversation/task';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { boundRagConversationHistory } from './evidencePayload';

/** Snapshot exactly the bounded, redacted user reports sent to the model. */
export function prepareConversationHistory(
  history: readonly RagConversationMessage[],
  registry: LocalEvidenceReferenceRegistry,
) {
  const messages = boundRagConversationHistory(history).map(message => ({
    ...message,
    content: registry.redactText(message.content),
  }));
  return {
    messages,
    reports: messages
      .filter(message => message.role === 'user')
      .map(message => message.content),
  };
}

/** An empty history has no source to revalidate. */
export function conversationHistoryIsCurrent(
  registry: LocalEvidenceReferenceRegistry,
  references: readonly EvidenceReference[],
  signal: AbortSignal,
) {
  return (
    references.length === 0 || registry.revalidateEvidence(references, signal)
  );
}

/** Bind retained user reports to their validated conversation turns, never to prior AI claims. */
export async function conversationHistorySources(input: {
  readonly history: readonly RagConversationMessage[];
  readonly session?: { readonly id: string; readonly version: number };
  readonly data: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly signal: AbortSignal;
}): Promise<{
  references: readonly EvidenceReference[];
  sources: readonly EvidenceReference[];
  priorTurns: readonly { question: string; answer: string }[];
}> {
  const questions = input.history
    .slice(-8)
    .filter(message => message.role === 'user')
    .map(message => message.content)
    .reverse();
  const session = input.session;
  if (!questions.length || !session)
    return { references: [], sources: [], priorTurns: [] };
  const discovery = await input.data.conversationArtifactDiscovery?.(
    input.registry,
  );
  // A store without discovery can still retain the user's reports, but cannot
  // supply an independently validated prior assistant response.
  if (!discovery) return { references: [], sources: [], priorTurns: [] };
  const turns: Awaited<
    ReturnType<typeof discovery.readSession>
  >['items'][number][] = [];
  let cursor: { readonly createdAt: string; readonly id: string } | undefined;
  do {
    const page = await discovery.readSession({
      sessionId: session.id,
      ...(cursor ? { cursor } : {}),
      signal: input.signal,
    });
    if (page.unavailableCount)
      throw new Error('Conversation history is unavailable.');
    turns.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (turns.length < questions.length && cursor && !input.signal.aborted);
  // A local-only response or failed save can leave a user report without a
  // durable assistant turn. Keep the report, but never invent its prior answer.
  const selected = questions.flatMap(question => {
    const matches = turns.filter(turn => turn.question === question);
    return matches.length === 1 &&
      questions.filter(item => item === question).length === 1
      ? matches
      : [];
  });
  if (
    input.signal.aborted ||
    (await discovery.activeSessionVersion(session.id)) !== session.version ||
    !(await discovery.revalidateSession(
      session.id,
      session.version,
      selected,
      input.signal,
    ))
  )
    throw new Error('Conversation history changed or was not saved.');

  const references = selected.map(turn => {
    const readSource = async (signal: AbortSignal) => {
      if (
        (await discovery.activeSessionVersion(session.id)) !== session.version
      )
        return { status: 'missing' as const };
      const current = await discovery.read(turn.id, signal);
      if (!current || current.metadata.originSession !== session.id)
        return { status: 'missing' as const };
      if (current.metadata.revision !== turn.revision)
        return { status: 'changed' as const };
      return {
        status: 'available' as const,
        document: {
          sourceKind: 'generated_artifact' as const,
          metadata: current.metadata,
          conversation: current.content,
          sources: current.sources,
          sourceStatus: current.sourceStatus,
        },
      };
    };
    return referenceOnly(
      input.registry.add({
        reference: {
          sourceKind: 'generated_artifact',
          sourceId: turn.id,
          sourceRevision: turn.revision,
          evidenceId: turn.id,
          evidenceRevision: turn.revision,
          locator: { kind: 'generated_artifact', type: 'conversation_turn' },
          effectiveTime: null,
          reviewState: 'unreviewed',
        },
        content: '',
        readSource,
        validate: async signal =>
          (await readSource(signal)).status === 'available',
      }),
    );
  });
  // The retained answer supplies the question being answered, not medical evidence.
  const priorTurns = selected
    .slice()
    .reverse()
    .map(turn => ({
      question: input.registry.redactText(turn.question.slice(0, 1000)),
      answer: input.registry.redactText(turn.answer.slice(0, 1000)),
    }));
  // Flatten source dependencies: nesting every earlier turn would exhaust the
  // storage ancestry limit in ordinary long conversations.
  const sources = selected.flatMap(turn => turn.sources);
  return { references, sources, priorTurns };
}
