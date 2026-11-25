import { createConversationA2UIInteractions } from './conversationA2UIInteractions';

export const localA2UICheckLabel = '이 화면에서만 확인 표시';
export const localA2UICheckPath = '/local/checked';

export const localA2UIDraftFieldLabel = '이 화면에서만 쓰는 메모';
export const localA2UIDraftResetLabel = '메모 지우기';
export const localA2UIDraftPath = '/local/draft';
export const localA2UIDraftResetAction = 'orot:reset-local-draft';

/** Only final verified, visible nodes may be supplied. The app chooses all
 * labels, the only editable path and the only handler; model strings do not
 * become native behavior or leave this mounted draft. */
export type ConversationA2UILocalDraft =
  | Readonly<{ fieldId: string; resetId: string; kind?: never }>
  | Readonly<{ fieldId: string; kind: 'checkbox' }>;

export function mountConversationA2UILocalDraft(
  approved: ConversationA2UILocalDraft,
  surfaceId: string,
  isCurrent: () => boolean,
) {
  const owner = {};
  const { fieldId } = approved;
  const checkbox = approved.kind === 'checkbox';
  const resetId = checkbox ? undefined : approved.resetId;
  const store = createConversationA2UIInteractions({
    owner,
    surfaceId,
    renderedComponentIds: new Set(resetId ? [fieldId, resetId] : [fieldId]),
    allowedActionNames: new Set(resetId ? [localA2UIDraftResetAction] : []),
    fields: [
      {
        componentId: fieldId,
        path: checkbox ? localA2UICheckPath : localA2UIDraftPath,
        kind: checkbox ? 'boolean' : 'text',
        initial: checkbox ? false : '',
      },
    ],
    events: resetId
      ? [{ componentId: resetId, name: localA2UIDraftResetAction, context: [] }]
      : [],
    isCurrent,
  });
  if (!store) return undefined;
  const field = { owner, surfaceId, componentId: fieldId };
  const reset = resetId
    ? { owner, surfaceId, componentId: resetId }
    : undefined;
  return {
    change(componentId: string, value: string | boolean) {
      return componentId === fieldId && store.write(field, value);
    },
    reset(componentId: string) {
      if (!reset || componentId !== resetId) return false;
      const receipt = store.prepareAction(reset, localA2UIDraftResetAction);
      return Boolean(
        receipt && store.consumeAction(reset, receipt) && store.revert(field),
      );
    },
    read(componentId: string) {
      const result = componentId === fieldId ? store.read(field) : undefined;
      return typeof result === 'string' || typeof result === 'boolean'
        ? result
        : undefined;
    },
    retire: store.retire,
  };
}
