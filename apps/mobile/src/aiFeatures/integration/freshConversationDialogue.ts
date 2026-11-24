import type { HistoricalDialogueParent } from '../../storage/protectedPromptHistory';
import { ConversationHistoryFailure } from './conversationHistoryFailure';
import {
  loadConversationHistory,
  prepareConversationHistory,
} from './conversationHistorySources';
import { providerHistoryMessage } from '../../ragConversation/conversationHistoryPayload';

type Input = Parameters<typeof loadConversationHistory>[0];
type LegacyHistory = Awaited<ReturnType<typeof loadConversationHistory>>;
export type FreshConversationHistory = LegacyHistory & {
  historicalDialogueParents?: readonly HistoricalDialogueParent[];
  dialogueOwnerIsCurrent?: () => Promise<boolean>;
};

/** Old committed text is dialogue, not an evidence registration. The current
 * request still validates its own inputs as they are actually selected. */
export async function loadFreshConversationDialogue(
  input: Input,
  recoverImplicitHistory: boolean,
): Promise<FreshConversationHistory | undefined> {
  const session = input.session;
  const open = input.data.openConversationArtifactStorage;
  if (!session || !open) return undefined;
  const storage = await open();
  // Older adapters cannot grant the new path. Their original protected
  // evidence-aware reader remains the safe fallback.
  if (
    typeof storage.readProtectedPromptHistory !== 'function' ||
    typeof storage.protectedPromptHistoryIsCurrent !== 'function'
  )
    return undefined;
  if (input.signal.aborted)
    throw new ConversationHistoryFailure('history_cancelled');
  const expected = input.retainedHistory ?? [];
  const selected = await storage.readProtectedPromptHistory(
    session.id,
    session.version,
    expected.map(turn => turn.id),
    input.signal,
    recoverImplicitHistory,
  );
  if (!selected)
    throw new ConversationHistoryFailure(
      input.signal.aborted ? 'history_cancelled' : 'history_session_changed',
    );
  // Keep exact prior question matching and output order without repeated scans.
  const selectedQuestions = new Map<string, Set<string>>();
  for (const { id, question } of selected) {
    let questions = selectedQuestions.get(id);
    if (!questions) selectedQuestions.set(id, (questions = new Set()));
    questions.add(question);
  }
  const omit = expected.filter(
    ({ id, question }) => !selectedQuestions.get(id)?.has(question),
  );
  const omittedIds = new Set(omit.map(({ id }) => id));
  const turns = selected.filter(({ id }) => !omittedIds.has(id));
  const parents = turns.map(({ id, createdAt }) => ({ id, createdAt }));
  const priorTurns = turns.map(({ question, answer }) => ({
    question: input.registry.redactText(question),
    answer: input.registry.redactText(answer),
  }));
  const messages = turns.flatMap(turn => [
    providerHistoryMessage({ role: 'user', content: turn.question }),
    providerHistoryMessage({ role: 'assistant', content: '' }),
  ]);
  return {
    ...prepareConversationHistory(messages, input.registry),
    references: [],
    sources: [],
    historicalDialogueParents: parents,
    priorTurns,
    omitted: omit.length > 0,
    excludedQuestions: omit.map(turn => turn.question),
    dialogueOwnerIsCurrent: () =>
      storage.protectedPromptHistoryIsCurrent(
        session.id,
        session.version,
        parents,
        input.signal,
      ),
  };
}

export function historyHasDurableContext(history: FreshConversationHistory) {
  return Boolean(
    history.references.length || history.historicalDialogueParents?.length,
  );
}
