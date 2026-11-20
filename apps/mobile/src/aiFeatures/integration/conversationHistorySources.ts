import { validateCaptureHistory } from './evidenceCaptureBatch';
import { readSelectedConversationHistory } from './readSelectedConversationHistory';
import { ConversationHistoryFailure } from './conversationHistoryFailure';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { RagConversationMessage } from '../../ragConversation/task';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { boundRagConversationHistory } from './evidencePayload';

/** Snapshot every eligible, redacted user report sent to the model. */
export function prepareConversationHistory(
  history: readonly RagConversationMessage[],
  registry: LocalEvidenceReferenceRegistry,
  excludedQuestions: readonly string[] = [],
) {
  const excluded = new Set(excludedQuestions);
  const eligible = history.filter(
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
  if (!references.length) return true;
  return validateCaptureHistory(registry, references, signal);
}

/** Prepare the same validated reports for model dispatch and durable retention. */
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
  readonly recoverImplicitHistory?: boolean;
}): Promise<{
  references: readonly EvidenceReference[];
  sources: readonly EvidenceReference[];
  priorTurns: readonly { question: string; answer: string }[];
  omitted: boolean;
  excludedQuestions: readonly string[];
  recoveredOwnerIsCurrent?: () => Promise<boolean>;
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
  if (!discovery)
    throw new ConversationHistoryFailure('history_discovery_unavailable');
  const ownerIsCurrent = async () =>
    !input.signal.aborted &&
    (await discovery.activeSessionVersion(session.id)) === session.version &&
    !input.signal.aborted;
  const select = async (recover: boolean) => {
    const turns = await readSelectedConversationHistory(
      discovery,
      session.id,
      expected.map(item => item.id),
      input.signal,
      recover,
    );
    const selected = expected.flatMap(item => {
      const turn = turns.find(
        candidate =>
          candidate.id === item.id && candidate.question === item.question,
      );
      return turn ? [turn] : [];
    });
    if (input.signal.aborted)
      throw new ConversationHistoryFailure('history_cancelled');
    if (!recover && selected.length !== expected.length)
      throw new ConversationHistoryFailure('history_turn_unavailable');
    if (!(await ownerIsCurrent()))
      throw new ConversationHistoryFailure('history_session_changed');
    if (
      selected.length &&
      !(await discovery.revalidateSession(
        session.id,
        session.version,
        selected,
        input.signal,
      ))
    )
      throw new ConversationHistoryFailure('history_sources_stale');
    if (recover && !(await ownerIsCurrent()))
      throw new ConversationHistoryFailure('history_session_changed');
    return selected;
  };
  let selected;
  let recovered = false;
  try {
    selected = await select(false);
  } catch (error) {
    // One local reread can recover an implicit context from current sources. An
    // unknown read error or changed session never authorizes dropping the fence.
    if (
      !input.recoverImplicitHistory ||
      !(error instanceof ConversationHistoryFailure) ||
      ![
        'history_page_unavailable',
        'history_turn_unavailable',
        'history_sources_stale',
      ].includes(error.code) ||
      !(await ownerIsCurrent())
    )
      throw error;
    selected = await select(true);
    recovered = true;
  }
  const accepted = new Map(selected.map(turn => [turn.id, turn.question]));
  const excludedQuestions = expected
    .filter(turn => accepted.get(turn.id) !== turn.question)
    .map(turn => turn.question);

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
        capture: discovery.captureOwner
          ? {
              owner: discovery.captureOwner,
              identity: { id: turn.id, revision: turn.revision, session },
            }
          : undefined,
        readSource,
        validate: async signal =>
          (await readSource(signal)).status === 'available',
      }),
    );
  });
  // Every selected turn has passed identity, session and source validation above.
  // Keep its complete lineage rather than dropping older turns to meet a local quota.
  const admitted = selected;
  const priorTurns = admitted
    .slice()
    .reverse()
    .map(turn => ({
      question: input.registry.redactText(turn.question),
      answer: input.registry.redactText(turn.answer),
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
    omitted: excludedQuestions.length > 0,
    excludedQuestions,
    ...(recovered ? { recoveredOwnerIsCurrent: ownerIsCurrent } : {}),
  };
}
