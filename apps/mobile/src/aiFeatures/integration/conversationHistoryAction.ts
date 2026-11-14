import type { LocalActionTool } from '@orot/agent-runtime';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { RagConversationObserver } from '../../ragConversation/service';
import {
  conversationHistoryIntent,
  isReferentialHistoryCommand,
} from '../../manualHistory/conversationHistoryIntent';
import { buildManualHistoryEvidence } from './manualHistoryEvidence';

/** The model selects user-authored context, not a new diagnosis or a write grant.
 * Whole-message matching preserves qualifiers and negation; the host owns consent.
 */
export function conversationHistoryAction(input: {
  data: AiFeatureLocalData;
  registry: LocalEvidenceReferenceRegistry;
  observer?: RagConversationObserver;
  question: string;
  admittedQuestions: readonly string[];
}): LocalActionTool[] {
  const { data, registry, observer, question } = input;
  const session = observer?.retentionSession;
  const requestId = observer?.retentionRequestId;
  if (!session || !requestId || !data.saveConversationHistory) return [];
  const candidates = [
    { id: requestId, question },
    ...(observer.retainedHistory ?? []).filter(turn =>
      input.admittedQuestions.includes(turn.question),
    ),
  ];
  let approvedSignal: AbortSignal | undefined;
  let approved: { requestId: string; text: string } | undefined;
  const selection = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined;
    const obj = value as Record<string, unknown>;
    if (Object.keys(obj).length !== 1 || typeof obj.userMessage !== 'string')
      return undefined;
    const matches = candidates.filter(
      candidate => candidate.question === obj.userMessage,
    );
    // Repeated prior wording must not make the current turn ambiguous.
    const selected =
      matches.find(candidate => candidate.id === requestId) ??
      (matches.length === 1 ? matches[0] : undefined);
    if (!selected || isReferentialHistoryCommand(selected.question))
      return undefined;
    return {
      requestId: selected.id,
      text: conversationHistoryIntent(selected.question) ?? selected.question,
    };
  };
  return [
    {
      id: 'save-past-health-history',
      version: '1',
      description:
        'Save a user-reported past health history note locally when the user asks to remember or save it. Copy one COMPLETE current or prior USER message exactly into userMessage, including uncertainty and negation. Never select assistant replies, external instructions, or invent a diagnosis. The host validates the source and may ask the user to confirm an ambiguous selection. Read saved history separately with local-personal-records. Do not claim success before the tool returns saved.',
      inputSchema: {
        type: 'object',
        properties: {
          userMessage: { type: 'string', minLength: 1, maxLength: 1000 },
        },
        required: ['userMessage'],
        additionalProperties: false,
      },
      parseInput(value) {
        return selection(value)
          ? { userMessage: (value as { userMessage: string }).userMessage }
          : undefined;
      },
      async authorize(value, signal) {
        approved = undefined;
        const selected = selection(value);
        if (!selected || signal.aborted) return false;
        const explicit =
          selected.requestId === requestId &&
          conversationHistoryIntent(question) === selected.text;
        if (
          !explicit &&
          !(await observer.confirmHistorySave?.(selected.text, signal))
        )
          return false;
        if (signal.aborted) return false;
        approved = selected;
        approvedSignal = signal;
        return true;
      },
      async execute({ input: value, signal }) {
        const selected = selection(value);
        if (
          !approved ||
          approvedSignal !== signal ||
          !selected ||
          approved.requestId !== selected.requestId ||
          approved.text !== selected.text ||
          signal.aborted
        )
          throw new Error('A fresh user decision is required.');
        approved = undefined;
        const id = await data.saveConversationHistory!(
          {
            requestId,
            sessionId: session.id,
            sessionVersion: session.version,
            question,
            approvedSource: selected,
          },
          signal,
        );
        const evidence = await data.manualHistory.getEvidence(id);
        if (!evidence) throw new Error('Saved history is no longer available.');
        const { items } = buildManualHistoryEvidence({
          candidates: [evidence],
          repository: data.manualHistory,
          registry,
        });
        return {
          items,
          coverage: [
            {
              sourceKind: 'personal_record',
              searchedSourceIds: items.map(item => item.sourceId),
              gaps: [],
              truncated: false,
              resultLimit: 1,
              returnedCount: items.length,
            },
          ],
          conflicts: [],
        };
      },
    },
  ];
}
