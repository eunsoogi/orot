import { withoutReportTemplate } from './conversationLegacyTemplateMessages';
import { legacyCompletionTask } from './conversationLegacyCompletion';
import { ragConversationTask } from './task';
import { validateInitialConversationResponse } from './initialResponse';

const legacyInitialResponseInstruction =
  'For a direct answer, return the final result without an acknowledgment. When you need a supplied tool, write a brief natural Korean first reply in the tool-call assistant message text that responds to this particular request. Use non-factual conversational support or explain what you intend to look into. Do not copy a canned receipt. Do not answer medical questions, give advice, assert facts about records, expose measurements, or claim any investigation or action already occurred. Do not quote private details. The first reply is provisional, never the final result; continue the same task after tools and return the validated final answer. ';

// Two shipped v9 policies differ by this bounded fallback. Only these known prompts
// may be restored; protected exactInput is still compared in full by the factory.
const publicFallbackInstruction =
  'If optional public web research failed, answer a supported local-record question with completion=partial using only its supplied local evidence, and state that public research was unavailable. Never invent external findings. ';

/** Retain previous tool-preview ordering for either protected v9 policy. New sends
 * use v14; restoration never creates a new opening or mutates a saved checkpoint. */
export function restoreConversationTask(
  identity: { taskType: string; taskVersion: string },
  exactInput?: string,
): typeof ragConversationTask | undefined {
  if (identity.taskType !== ragConversationTask.taskType) return undefined;
  if (identity.taskVersion === ragConversationTask.taskVersion)
    return ragConversationTask;
  if (identity.taskVersion === '13')
    return {
      ...ragConversationTask,
      taskVersion: '13',
      createMessages: input =>
        withoutReportTemplate(ragConversationTask.createMessages(input)),
    };
  if (identity.taskVersion === '11') {
    const legacy = {
      ...ragConversationTask,
      taskVersion: '11',
      createMessages: (
        input: Parameters<typeof ragConversationTask.createMessages>[0],
      ) => withoutReportTemplate(ragConversationTask.createMessages(input)),
    };
    delete legacy.nativeToolResultMode;
    return legacy;
  }
  if (identity.taskVersion === '10') return legacyCompletionTask();
  if (identity.taskVersion !== '9') return undefined;
  const withFallback = {
    ...legacyCompletionTask(),
    taskVersion: '9',
    initialToolResponse: validateInitialConversationResponse,
    reviewInitialToolResponse: true,
    systemPrompt:
      legacyInitialResponseInstruction + legacyCompletionTask().systemPrompt,
  };
  const original: typeof ragConversationTask = {
    ...withFallback,
    systemPrompt: withFallback.systemPrompt.replace(
      publicFallbackInstruction,
      '',
    ),
  };
  delete original.acceptsIncompleteEvidence;
  // Never infer authorization from text. This only selects an allowlisted historic
  // task; the factory's existing exact-input and source/consent gates still apply.
  return !exactInput ||
    exactInput.includes(
      `"systemPrompt":${JSON.stringify(original.systemPrompt)}`,
    )
    ? original
    : withFallback;
}
