import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationSession } from './conversationSessionTypes';
import { getRagConversationCopy } from './copy';
import { t } from '../i18n';

type RestoredTurn = {
  readonly question: string;
  readonly answer: string;
  readonly citations: readonly EvidenceReference[];
  readonly completion?: 'complete' | 'partial';
  readonly entryIntent?: 'possibilities';
  readonly dailyReport?: NonNullable<ConversationEntryContext['dailyReport']>;
  readonly toolMessageId?: string;
  readonly toolEvents?: readonly import('@orot/agent-runtime').ConversationToolEvent[];
  readonly healthSummary?: import('./healthSummary').HealthSummaryResult | null;
  readonly visitQuestions?: import('./conversationVisitQuestions').ConversationVisitQuestions;
  readonly visitQuestionsUnavailable?: boolean;
};

/** Rebuild displayed turns with freshly validated sources, and keep failures retryable. */
export function createConversationSessionRestoreState(input: {
  read?: (id: string, signal: AbortSignal) => Promise<readonly RestoredTurn[]>;
  update: (id: number, change: Partial<ConversationSession>) => void;
}) {
  const sessions = new Map<
    number,
    { durableId: string; controller?: AbortController }
  >();
  const run = async (id: number) => {
    const entry = sessions.get(id);
    if (!entry || entry.controller || !input.read) return;
    const controller = new AbortController();
    entry.controller = controller;
    input.update(id, { restoring: true, restoreFailed: false });
    try {
      const turns = await input.read(entry.durableId, controller.signal);
      if (sessions.get(id) !== entry || controller.signal.aborted) return;
      const reports = turns.flatMap(turn =>
        turn.dailyReport ? [turn.dailyReport] : [],
      );
      // A session must never silently switch to a different report revision.
      if (
        reports.some(
          report => JSON.stringify(report) !== JSON.stringify(reports[0]),
        )
      )
        throw new Error('Conflicting report targets.');
      const messages = turns.flatMap((turn, index) => [
        ...(turn.question
          ? [
              {
                id: -(2 * index + 1),
                role: 'user' as const,
                content: turn.question,
              },
            ]
          : []),
        {
          id: -(2 * index + 2),
          role: 'assistant' as const,
          content: turn.answer,
          citations: turn.citations,
          toolMessageId: turn.toolMessageId,
          ...(turn.question && turn.toolMessageId
            ? { retainedTurnId: turn.toolMessageId }
            : {}),
          toolEvents: turn.toolEvents,
          ...(turn.healthSummary !== undefined
            ? { healthSummary: turn.healthSummary }
            : {}),
          visitQuestions: turn.visitQuestions,
          visitQuestionsUnavailable: turn.visitQuestionsUnavailable,
          ...(!turn.question && !turn.answer ? { incomplete: true } : {}),
          ...(turn.completion ? { completion: turn.completion } : {}),
        },
      ]);
      input.update(id, {
        messages,
        dailyReport: reports[0],
        // Only validated retained turns can restore an exploration intent.
        entryIntent: turns.some(turn => turn.entryIntent === 'possibilities')
          ? 'possibilities'
          : undefined,
        title:
          messages[0]?.content.slice(0, 36) ||
          getRagConversationCopy().newConversation,
        error: '',
        restoreFailed: false,
        restoring: false,
      });
      sessions.delete(id);
    } catch {
      if (sessions.get(id) === entry && !controller.signal.aborted)
        input.update(id, {
          error: t('ragConversation.history.restoreFailed'),
          restoreFailed: true,
        });
    } finally {
      if (sessions.get(id) === entry) {
        entry.controller = undefined;
        input.update(id, { restoring: false });
      }
    }
  };
  const forget = (id: number) => {
    sessions.get(id)?.controller?.abort();
    sessions.delete(id);
  };
  return {
    async start(id: number, durableId: string) {
      forget(id);
      sessions.set(id, { durableId });
      await run(id);
    },
    retry: run,
    forget,
    dispose() {
      for (const id of sessions.keys()) forget(id);
    },
  };
}
