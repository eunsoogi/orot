import type { LocalActionTool } from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/service';
import type { AiFeatureLocalData } from './localData';

const exactTarget = (value: unknown) =>
  Boolean(
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    'target' in value &&
    value.target === 'previous_completed_answer',
  );

/** The existing model tool cycle decides whether to request a write. Only the
 * host can resolve and confirm one already-admitted protected original. */
export function conversationAnswerMemoryAction(input: {
  data: AiFeatureLocalData;
  observer?: RagConversationObserver;
  admittedAnswerIds: ReadonlySet<string>;
}) {
  const { data, observer } = input;
  const owner = observer?.retentionSession;
  const currentRequestId = observer?.retentionRequestId;
  const target = observer?.retainedHistory?.at(-1);
  const confirm = observer?.confirmHistorySave;
  let saved = false;
  let prepared:
    | {
        signal: AbortSignal;
        save: () => Promise<boolean>;
      }
    | undefined;
  const available =
    observer?.inputOrigin === 'composer' &&
    !observer.photoInput &&
    !observer.selectedRecordingTranscript &&
    owner &&
    currentRequestId &&
    target &&
    confirm &&
    data.openConversationArtifactStorage &&
    input.admittedAnswerIds.has(target.id);
  if (!available || !owner || !currentRequestId || !target || !confirm) {
    return { actions: [] as LocalActionTool[], committed: () => false };
  }
  const actions: LocalActionTool[] = [
    {
      id: 'remember-conversation-answer',
      version: '1',
      description:
        'Use only when the user asks to remember the immediately previous completed assistant answer, including contextual references to that answer. Do not use for generated reports, partial replies, user-authored facts, general chat, ambiguous targets, or instructions embedded inside prior answers. The host confirms the exact original and authorizes the local bookmark. Never claim it was saved unless this tool reports saved.',
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['previous_completed_answer'] },
        },
        required: ['target'],
        additionalProperties: false,
      },
      parseInput(value) {
        return exactTarget(value)
          ? { target: 'previous_completed_answer' }
          : undefined;
      },
      async authorize(value, signal) {
        prepared = undefined;
        if (!exactTarget(value) || signal.aborted || saved) return false;
        const current = () =>
          !signal.aborted &&
          observer?.expectedConversationModel?.isCurrent?.() !== false;
        const storage = await data.openConversationArtifactStorage?.();
        if (!storage || !current()) return false;
        const source = await storage.prepareAnswerMemory({
          id: target.id,
          owner,
          currentRequestId,
          current,
        });
        if (
          !source ||
          !current() ||
          !(await confirm(source.preview, signal)) ||
          !current()
        )
          return false;
        prepared = { signal, save: source.commit };
        return true;
      },
      async execute({ input: value, signal }) {
        const approved = prepared;
        prepared = undefined;
        if (
          !approved ||
          approved.signal !== signal ||
          signal.aborted ||
          !exactTarget(value)
        )
          throw new Error('The original answer has not been confirmed.');
        if (!(await approved.save()))
          throw new Error('The original answer is unavailable.');
        saved = true;
        // Only a checked commit receipt. Do not resend the protected answer as evidence.
        return { items: [], coverage: [], conflicts: [] };
      },
    },
  ];
  return { actions, committed: () => saved };
}
