import type { ConversationExecutionAdapter } from '../ragConversation/conversationExecutionLease';

export async function isProtectedDataReadable(
  protection: ConversationExecutionAdapter,
) {
  try {
    return (await protection.protectedDataAvailable()) === true;
  } catch {
    return false;
  }
}
