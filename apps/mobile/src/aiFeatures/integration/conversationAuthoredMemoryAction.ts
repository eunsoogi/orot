import type { LocalActionTool } from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/service';
import { exactAuthoredMemorySentence } from '../../storage/authoredMemorySelection';
import type { AiFeatureLocalData } from './localData';

export function conversationAuthoredMemoryAction(input: {
  data: AiFeatureLocalData;
  observer?: RagConversationObserver;
  question: string;
}) {
  const { data, observer, question } = input;
  const owner = observer?.retentionSession;
  const requestId = observer?.retentionRequestId;
  const confirm = observer?.confirmHistorySave;
  const model = observer?.expectedConversationModel;
  let receipt: 'not_attempted' | 'not_saved' | 'saved' = 'not_attempted';
  const result = { actions: [] as LocalActionTool[], receipt: () => receipt };
  if (
    observer?.inputOrigin !== 'composer' ||
    observer.photoInput ||
    observer.selectedRecordingTranscript ||
    !requestId ||
    !owner ||
    !confirm ||
    !model?.isCurrent ||
    !data.saveConversationHistory
  )
    return result;
  const parse = (value: unknown) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).length !== 1 ||
      !('statement' in value) ||
      !exactAuthoredMemorySentence(question, value.statement)
    )
      return undefined;
    return { statement: value.statement };
  };
  let approved: { statement: string; signal: AbortSignal } | undefined;
  const current = (signal: AbortSignal) =>
    !signal.aborted && model.isCurrent?.() === true;
  result.actions.push({
    id: 'remember-current-user-statement',
    version: '1',
    description:
      'Use only when the current user explicitly asks to remember a fact, plan, practice, project, goal or preference they directly state in this same message. Copy exactly one complete factual sentence from the current user message; never copy the request to save, filler, prior replies, quoted text, questions, guesses or credentials. The app displays the exact sentence for local approval. Never claim it was saved without a successful tool result.',
    inputSchema: {
      type: 'object',
      properties: {
        statement: { type: 'string', minLength: 8, maxLength: 900 },
      },
      required: ['statement'],
      additionalProperties: false,
    },
    parseInput: parse,
    async authorize(value, signal) {
      approved = undefined;
      if (receipt !== 'not_attempted' || !current(signal)) return false;
      receipt = 'not_saved';
      const parsed = parse(value);
      if (
        !parsed ||
        !(await confirm(parsed.statement, signal)) ||
        !current(signal)
      )
        return false;
      approved = { ...parsed, signal };
      return true;
    },
    async execute({ input: value, signal }) {
      const grant = approved;
      approved = undefined;
      if (
        !grant ||
        grant.signal !== signal ||
        !current(signal) ||
        parse(value)?.statement !== grant.statement
      )
        throw new Error('A fresh authored memory approval is required.');
      const id = await data.saveConversationHistory?.(
        {
          requestId,
          sessionId: owner.id,
          sessionVersion: owner.version,
          question,
          localOnly: true,
          approvedCurrentSentence: {
            statement: grant.statement,
            current: () => current(signal),
          },
        },
        signal,
      );
      if (!id) throw new Error('The approved memory could not be saved.');
      receipt = 'saved';
      return { items: [], coverage: [], conflicts: [] };
    },
  });
  return result;
}
