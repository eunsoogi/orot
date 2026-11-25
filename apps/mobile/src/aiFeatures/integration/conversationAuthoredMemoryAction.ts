import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { observeAnswerMemoryProviderOwner } from './conversationAnswerMemoryProviderOwner';
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
  const nativeProof = observer?.templateProposalOwner;
  const onDeviceOwner =
    observer?.protectedLocalInput === true &&
    model?.providerId === APPLE_PROVIDER_ID &&
    nativeProof?.providerId === model.providerId &&
    nativeProof.modelId === model.modelId
      ? nativeProof
      : undefined;
  let approved:
    | {
        statement: string;
        signal: AbortSignal;
        guard?: ReturnType<typeof observeAnswerMemoryProviderOwner>;
      }
    | undefined;
  const dispose = () => {
    approved?.guard?.dispose();
    approved = undefined;
  };
  let receipt: 'not_attempted' | 'not_saved' | 'saved' = 'not_attempted';
  const result = {
    actions: [] as LocalActionTool[],
    receipt: () => receipt,
    dispose,
  };
  if (
    observer?.inputOrigin !== 'composer' ||
    observer.photoInput ||
    observer.selectedRecordingTranscript ||
    !requestId ||
    !owner ||
    !confirm ||
    (!model?.isCurrent && !onDeviceOwner?.current()) ||
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
  const current = (
    signal: AbortSignal,
    guard?: NonNullable<typeof approved>['guard'],
  ) =>
    !signal.aborted &&
    (guard ? guard.isCurrent() : model?.isCurrent?.() === true);
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
      dispose();
      if (receipt !== 'not_attempted' || signal.aborted) return false;
      receipt = 'not_saved';
      const parsed = parse(value);
      if (!parsed) return false;
      const guard = onDeviceOwner
        ? observeAnswerMemoryProviderOwner(onDeviceOwner, signal)
        : undefined;
      let keep = false;
      try {
        if (
          !current(signal, guard) ||
          (guard && !(await guard.recheck())) ||
          !(await confirm(parsed.statement, signal)) ||
          !current(signal, guard) ||
          (guard && !(await guard.recheck()))
        )
          return false;
        approved = { ...parsed, signal, guard };
        keep = true;
        return true;
      } finally {
        if (!keep) guard?.dispose();
      }
    },
    async execute({ input: value, signal }) {
      const grant = approved;
      approved = undefined;
      try {
        if (
          !grant ||
          grant.signal !== signal ||
          !current(signal, grant.guard) ||
          (grant.guard && !(await grant.guard.recheck())) ||
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
              current: () => current(signal, grant.guard),
            },
          },
          signal,
        );
        if (!id) throw new Error('The approved memory could not be saved.');
        receipt = 'saved';
        return { items: [], coverage: [], conflicts: [] };
      } finally {
        grant?.guard?.dispose();
      }
    },
  });
  return result;
}
