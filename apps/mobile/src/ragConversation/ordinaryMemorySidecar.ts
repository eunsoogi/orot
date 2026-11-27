import type { LocalActionTool } from '@orot/agent-runtime';
import type { LocalConversationMemoryScope } from '../storage/ordinaryConversationMemoryEnrollment';
import {
  authoredMemorySegments,
  validateAuthoredRoutineSpan,
  validateReplyPreferenceSpan,
} from './authoredReplyPreferenceSpan';

const empty = { items: [], coverage: [], conflicts: [] };
type Authored = { scope: LocalConversationMemoryScope; statement: string };

function pick(
  question: string,
  originalScope: LocalConversationMemoryScope | undefined,
  ordinal: number,
): Authored | undefined {
  if (originalScope)
    return ordinal === 1
      ? { scope: originalScope, statement: question }
      : undefined;
  const statement = authoredMemorySegments(question)[ordinal - 1];
  if (validateReplyPreferenceSpan(question, statement))
    return { scope: 'reply-preferences', statement };
  if (validateAuthoredRoutineSpan(question, statement))
    return { scope: 'authored-routine', statement };
}

/** Only the model nominates an ordinal. No model-authored text or command pattern
 * can become a note. Actual storage requires a separate completed source. */
export function createOrdinaryMemorySidecar(input: {
  question: string;
  runId: string;
  originalScope?: LocalConversationMemoryScope;
  stage(witness: Authored, signal: AbortSignal): Promise<boolean>;
}): LocalActionTool {
  return {
    id: 'save-ordinary-conversation-memory',
    version: '1',
    completion: 'host_sidecar',
    description:
      'Optionally nominate one directly stated, lasting reply preference or recurring non-sensitive practice from this current user message. Choose only when useful across future chats, without needing a remember command. Supply its one-based complete-sentence position in the current message; if the entire message is the statement, use 1. Do not select questions, quotes, prior turns, sensitive records, or model inferences. An optional nomination is not a save receipt; give the normal answer and never claim it was saved.',
    inputSchema: {
      type: 'object',
      properties: { sentence: { type: 'integer', minimum: 0, maximum: 6 } },
      required: ['sentence'],
      additionalProperties: false,
    },
    parseInput(value) {
      const sentence =
        value &&
        typeof value === 'object' &&
        'sentence' in value &&
        Object.keys(value).length === 1 &&
        typeof value.sentence === 'number' &&
        Number.isSafeInteger(value.sentence) &&
        value.sentence >= 1 &&
        value.sentence <= 6
          ? value.sentence
          : 0;
      return { sentence };
    },
    async authorize() {
      // This authorizes only an in-memory nomination, never the durable write.
      return true;
    },
    async execute({ input: choice, signal, operationRunId }) {
      const witness =
        operationRunId === input.runId &&
        !signal.aborted &&
        typeof choice.sentence === 'number' &&
        pick(input.question, input.originalScope, choice.sentence);
      const staged = witness && (await input.stage(witness, signal));
      return { ...empty, sidecarStatus: staged ? 'staged' : 'ignored' };
    },
  };
}
