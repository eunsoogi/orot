import type { RagConversationObserver } from '../../ragConversation/service';
import type { SelectedAiResolution } from './provider';

type Owner = NonNullable<RagConversationObserver['templateProposalOwner']>;

/** The existing native plan owner proves the exact account, model, foreground,
 * protected store, and retained request without a provider or catalog call. */
export function conversationAnswerMemoryProviderOwner(
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  observer?: RagConversationObserver,
): Owner | undefined {
  const proof = observer?.templateProposalOwner;
  if (
    !selected.remoteProcessing ||
    !selected.provider.id.startsWith('chatgpt-plan:') ||
    !selected.provider.capabilities.toolCalling ||
    observer?.protectedLocalInput ||
    observer?.expectedVoiceSelection ||
    proof?.providerId !== selected.provider.id ||
    proof.modelId !== selected.modelId ||
    !proof.current()
  )
    return;
  return proof;
}

/** Once local confirmation starts, a device/owner transition cannot revive it. */
export function observeAnswerMemoryProviderOwner(
  owner: Owner,
  signal: AbortSignal,
) {
  let current = true;
  let unwatch: (() => void) | undefined;
  const dispose = () => {
    current = false;
    unwatch?.();
    unwatch = undefined;
    signal.removeEventListener('abort', dispose);
  };
  unwatch = owner.watch(dispose);
  if (current && !signal.aborted)
    signal.addEventListener('abort', dispose, { once: true });
  else dispose();
  const isCurrent = () => current && !signal.aborted && owner.current();
  async function recheck() {
    if (!isCurrent()) return false;
    try {
      return (await owner.recheck(signal)) && isCurrent();
    } catch {
      return false;
    }
  }
  return { isCurrent, recheck, dispose };
}
