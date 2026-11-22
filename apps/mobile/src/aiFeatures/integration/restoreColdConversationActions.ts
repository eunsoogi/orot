import type { ColdDialogueCurrent } from './coldPromptDialogue';
import type { JsonObject } from '@orot/model-runtime';
import type { LocalActionTool } from '@orot/agent-runtime';
import type { ConversationColdResumeDescriptor } from '../../storage/conversationColdResumeDescriptor';
import { conversationHistoryAction } from './conversationHistoryAction';
import { readColdRagCompletion } from './coldRagCompletion';
import { stableJson } from './evidenceUtils';

/** Persist only the allowlisted action contract, never a live authorization grant. */
export function coldActionContracts(actions: readonly LocalActionTool[] = []) {
  return actions.map(({ id, version, description, inputSchema }) => ({
    id,
    version,
    description,
    inputSchema,
  }));
}

/** Recreate never-dispatched action capabilities after a model-authorization pause.
 * Pending/committed mutations remain blocked by the runtime. A later action still
 * validates its exact user-authored source and asks for a fresh decision.
 */
export async function restoreColdConversationActions(
  input: {
    descriptor: ConversationColdResumeDescriptor;
    signal: AbortSignal;
    dialogueCurrent?: ColdDialogueCurrent;
  } & Omit<
    Parameters<typeof conversationHistoryAction>[0],
    'question' | 'admittedQuestions'
  >,
) {
  const { descriptor: d, observer } = input;
  const original = d.reconstruction.invocation as JsonObject;
  const contracts = original.actions;
  if (
    contracts === undefined ||
    (Array.isArray(contracts) && contracts.length === 0)
  )
    return undefined;
  if (
    !Array.isArray(contracts) ||
    original.photo !== null ||
    observer?.retentionRequestId !== d.manifest.requestId ||
    observer.retentionSession?.id !== d.manifest.sessionId ||
    observer.retentionSession.version !== d.manifest.sessionVersion
  )
    throw new Error('Cold action ownership changed.');
  const completion = await readColdRagCompletion(
    d.reconstruction,
    input.registry,
    input.signal,
    input.dialogueCurrent,
  );
  const actions = conversationHistoryAction({
    data: input.data,
    registry: input.registry,
    observer,
    question: d.request,
    admittedQuestions: completion.priorDialogue.map(turn => turn.question),
  });
  if (
    input.signal.aborted ||
    stableJson(coldActionContracts(actions)) !== stableJson(contracts)
  )
    throw new Error('Cold action contract changed.');
  return actions;
}
