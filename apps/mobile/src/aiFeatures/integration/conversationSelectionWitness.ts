type MutationOwner = { capture(): (() => boolean) | null };

/** Capture before provider lookup. A matching model label or even the same
 * opaque provider ID after sign-out/sign-in cannot resurrect an old witness. */
export function captureConversationSelectionWitness(
  selection: MutationOwner,
  chatGPTCredentials: MutationOwner,
) {
  const selected = selection.capture();
  const credential = chatGPTCredentials.capture();
  return (providerId: string) => {
    const requiresAccount = providerId.startsWith('chatgpt-plan:');
    if (!selected || (requiresAccount && !credential)) return null;
    const current = () =>
      selected() && (!requiresAccount || credential?.() === true);
    return current() ? current : null;
  };
}
