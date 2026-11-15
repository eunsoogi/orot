import type { SqlDatabase } from '@orot/storage';
import type { ConversationContinuationIdentity } from './conversationWorkflowContinuationIdentity';
import { createConversationColdResumeStorage } from './conversationColdResumeStorage';
import { createConversationActionRecoveryClaim } from './conversationActionRecoveryClaim';
import { readConversationProcessIdentity } from '../ragConversation/conversationProcessIdentity';
import {
  encodeColdResume,
  type ConversationColdResumeDescriptor,
} from './conversationColdResumeDescriptor';

/** Ordinary safe drains stay on their existing path. A committed-action recovery
 * is offered only after native process death and exact protected receipt validation.
 */
export async function openConversationRecovery(
  database: SqlDatabase,
  identity: ConversationContinuationIdentity,
  signal: AbortSignal,
) {
  if (signal.aborted) return undefined;
  const safe =
    await createConversationColdResumeStorage(database).open(identity);
  if (safe && !signal.aborted)
    return { descriptor: safe, actionRecovery: undefined };
  const process = await readConversationProcessIdentity(signal);
  if (!process || signal.aborted) return undefined;
  const descriptor = await createConversationActionRecoveryClaim(database).open(
    identity,
    process,
    signal,
  );
  if (!descriptor || signal.aborted) return undefined;
  try {
    const saved = descriptor.stage
      .reconstruction as unknown as ConversationColdResumeDescriptor;
    encodeColdResume(saved);
    if (
      saved.manifest.requestId !== identity.requestId ||
      saved.checkpointId !== descriptor.stage.checkpointId ||
      saved.sourceEpoch !== descriptor.stage.epoch ||
      saved.attempt !== descriptor.stage.attempt
    )
      return undefined;
    return { descriptor: saved, actionRecovery: { descriptor, process } };
  } catch {
    return undefined;
  }
}
