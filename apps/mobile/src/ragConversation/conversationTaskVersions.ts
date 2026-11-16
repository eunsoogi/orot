import { ragConversationTask } from './task';
import { validateInitialConversationResponse } from './initialResponse';

const legacyInitialResponseInstruction =
  'For a direct answer, return the final result without an acknowledgment. When you need a supplied tool, write a brief natural Korean first reply in the tool-call assistant message text that responds to this particular request. Use non-factual conversational support or explain what you intend to look into. Do not copy a canned receipt. Do not answer medical questions, give advice, assert facts about records, expose measurements, or claim any investigation or action already occurred. Do not quote private details. The first reply is provisional, never the final result; continue the same task after tools and return the validated final answer. ';

/** Retain the exact previous tool-preview ordering and prompt for protected v9
 * journals. Only new sends use v10; restoration never generates a new opening. */
export function restoreConversationTask(identity: {
  taskType: string;
  taskVersion: string;
}) {
  if (identity.taskType !== ragConversationTask.taskType) return undefined;
  if (identity.taskVersion === ragConversationTask.taskVersion)
    return ragConversationTask;
  if (identity.taskVersion !== '9') return undefined;
  return {
    ...ragConversationTask,
    taskVersion: '9',
    initialToolResponse: validateInitialConversationResponse,
    reviewInitialToolResponse: true,
    systemPrompt:
      legacyInitialResponseInstruction + ragConversationTask.systemPrompt,
  };
}
