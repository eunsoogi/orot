import type { EvidenceReference } from '@orot/agent-runtime';
import type { RagConversationMessage } from '../../ragConversation/task';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { boundRagConversationHistory } from './evidencePayload';
import { stableJson } from './evidenceUtils';
import { CONVERSATION_SOURCE_LIMIT } from '../../storage/conversationArtifactCodec';
import { RAG_CONVERSATION_BUDGET } from '../../ragConversation/budget';

/** Reserve space for this turn's evidence before admitting previous AI text. */
export function selectDialogueBySourceBudget<
  T extends { readonly sources: readonly EvidenceReference[] },
>(
  turns: readonly T[],
  registry: Pick<LocalEvidenceReferenceRegistry, 'resolve'>,
) {
  const keys = new Set<string>();
  const admitted: T[] = [];
  const limit =
    CONVERSATION_SOURCE_LIMIT - RAG_CONVERSATION_BUDGET.maxEvidenceItems;
  for (const turn of turns) {
    const next = new Set(keys);
    for (const source of turn.sources)
      next.add(stableJson(registry.resolve(source) ?? source));
    if (next.size > limit) continue;
    admitted.push(turn);
    for (const key of next) keys.add(key);
  }
  return {
    admitted,
    omittedTurns: turns.filter(turn => !admitted.includes(turn)),
    omitted: admitted.length !== turns.length,
  };
}

/** Snapshot exactly the bounded, redacted user reports sent to the model. */
export function prepareConversationHistory(
  history: readonly RagConversationMessage[],
  registry: LocalEvidenceReferenceRegistry,
  excludedQuestions: readonly string[] = [],
) {
  const excluded = new Set(excludedQuestions);
  const eligible = history
    .slice(-8)
    .filter(
      message => message.role !== 'user' || !excluded.has(message.content),
    );
  const messages = boundRagConversationHistory(eligible).map(message => ({
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

/** Prepare the same bounded reports for model dispatch and durable retention. */
export async function loadConversationHistory(
  input: Parameters<typeof conversationHistorySources>[0] & {
    readonly messages: readonly RagConversationMessage[];
  },
) {
  const sources = await conversationHistorySources(input);
  return {
    ...sources,
    ...prepareConversationHistory(
      input.messages,
      input.registry,
      sources.excludedQuestions,
    ),
  };
}

/** Bind retained user reports to their validated conversation turns, never to prior AI claims. */
export async function conversationHistorySources(input: {
  readonly session?: { readonly id: string; readonly version: number };
  readonly retainedHistory?: readonly {
    readonly id: string;
    readonly question: string;
  }[];
  readonly data: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly signal: AbortSignal;
}): Promise<{
  references: readonly EvidenceReference[];
  sources: readonly EvidenceReference[];
  priorTurns: readonly { question: string; answer: string }[];
  omitted: boolean;
  excludedQuestions: readonly string[];
}> {
  const expected = (input.retainedHistory ?? []).slice().reverse();
  const session = input.session;
  if (!expected.length || !session)
    return {
      references: [],
      sources: [],
      priorTurns: [],
      omitted: false,
      excludedQuestions: [],
    };
  const discovery = await input.data.conversationArtifactDiscovery?.(
    input.registry,
  );
  // An identified retained turn must be revalidated before its text is sent.
  if (!discovery) throw new Error('Conversation history is unavailable.');
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
  } while (
    expected.some(item => !turns.some(turn => turn.id === item.id)) &&
    cursor &&
    !input.signal.aborted
  );
  const selected = expected.flatMap(item => {
    const turn = turns.find(
      candidate =>
        candidate.id === item.id && candidate.question === item.question,
    );
    return turn ? [turn] : [];
  });
  if (
    input.signal.aborted ||
    selected.length !== expected.length ||
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
  const bounded = selectDialogueBySourceBudget(selected, input.registry);
  const excludedQuestions = bounded.omittedTurns.map(turn => turn.question);
  const excluded = new Set(excludedQuestions);
  // Equal reports cannot be separated safely once one turn is omitted.
  const admitted = bounded.admitted.filter(
    turn => !excluded.has(turn.question),
  );
  const priorTurns = admitted
    .slice()
    .reverse()
    .map(turn => ({
      question: input.registry.redactText(turn.question.slice(0, 1000)),
      answer: input.registry.redactText(turn.answer.slice(0, 1000)),
    }));
  // Photo ownership belongs to the original request, so retain its validated
  // parent turn instead of assigning the original to a later request.
  const sources = admitted.flatMap(turn => {
    const parent = references[selected.indexOf(turn)]!;
    return turn.sources.map(source => {
      const locator = input.registry.resolve(source)?.locator;
      return locator &&
        typeof locator === 'object' &&
        'kind' in locator &&
        locator.kind === 'conversation_photo'
        ? parent
        : source;
    });
  });
  return {
    references,
    sources,
    priorTurns,
    omitted: bounded.omitted,
    excludedQuestions,
  };
}
