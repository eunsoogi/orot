import type { WarmConversationSelectionProof } from '../../ragConversation/conversationWarmAdmission';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import { nativeChatGPTSelectionServices } from '../../providers/selection/chatGPTServices';
import { selectedChatGPTAccountId } from './savedChatGPTModelLabel';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { createConversationSessionStorage } from './conversationSessionStorage';

type Target = Awaited<
  ReturnType<NonNullable<ConversationSessionOptions['continuousSession']>>
>;
type Lease = Pick<Target, 'id' | 'version'>;

/** Recheck exact local identity and the canonical existing lease. A previously
 * admitted pair is not proof that the server still offers this model: the
 * unchanged late runner must resolve the live catalog before consent/dispatch.
 */
export async function warmNativeChatGPTSelection(
  prior: Target | undefined,
  lease: Lease,
  signal: AbortSignal,
  openStorage: ReturnType<typeof createConversationSessionStorage>,
): Promise<WarmConversationSelectionProof | undefined> {
  if (prior?.id !== lease.id || prior.version !== lease.version) return;
  const model = prior.model;
  const account = selectedChatGPTAccountId(model);
  const witness = prior.selectionCurrent;
  if (!account || !witness?.()) return;
  const current = () => !signal.aborted && witness();
  function assertCurrent() {
    if (!current()) throw new Error('Conversation selection cancelled.');
  }
  assertCurrent();
  const saved = await providerSelectionStore.load();
  assertCurrent();
  if (saved?.providerId !== model.providerId || saved.modelId !== model.modelId)
    return; // An already changed saved selection still follows the original strict path.
  const accounts = await nativeChatGPTSelectionServices.listAccounts();
  assertCurrent();
  if (
    !accounts.some(
      item =>
        item.issuedClientID === account &&
        item.hasDirectPlanAccess &&
        !item.requiresSignIn,
    )
  )
    throw new Error('The conversation account is unavailable.');
  const storage = await openStorage();
  assertCurrent();
  if (!(await storage.validateWarmLease(model, lease, signal)))
    throw new Error('The conversation owner is unavailable.');
  assertCurrent();
  return {
    current,
    recheckOwner: async requestSignal =>
      current() &&
      (await storage.validateWarmLease(model, lease, requestSignal)) &&
      current(),
  };
}
