import type { ConversationA2UINode } from './conversationA2UI';
import type { RagConversationOutcome } from './outcome';

type Answer = Extract<RagConversationOutcome, { status: 'answer' }>;
const none: readonly string[] = [];
const owned = new WeakMap<
  ConversationA2UINode,
  { readonly answer: string; readonly notices: readonly string[] }
>();

/** Called only by app finalizers that add display copy after model admission.
 * Keep the original verified root identity and its local-control/owner binding.
 * The supplement never becomes a model frame or a new archive shape. */
export function appendConversationAppNotice(
  answer: Answer,
  notice: string,
): Answer {
  const content = `${answer.answer}\n\n${notice}`;
  const root = answer.a2uiPresentation;
  if (root) {
    const previous = owned.get(root);
    if (previous && previous.answer !== answer.answer)
      return {
        ...answer,
        answer: content,
        a2uiPresentation: undefined,
        a2uiLocalDraft: undefined,
      };
    owned.set(root, {
      answer: content,
      notices: [...(previous?.notices ?? none), notice],
    });
  }
  return { ...answer, answer: content };
}

/** Fall back to the complete body if the live root no longer matches its
 * exact supplemented body. Historical roots do not inherit this sidecar. */
export function conversationA2UIAppNotices(
  root: ConversationA2UINode,
  content: string,
) {
  const value = owned.get(root);
  return !value ? none : value.answer === content ? value.notices : undefined;
}
