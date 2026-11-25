import { createConversationA2UIInteractions } from './conversationA2UIInteractions';

export const localA2UICheckLabel = '이 화면에서만 확인 표시';
export const localA2UICheckPath = '/local/checked';

export const localA2UIChoicePath = '/local/choice';
export const localA2UIChoiceLabel = '이 화면에서만 항목 선택';
export const localA2UIChoiceClearLabel = '선택 지우기';
export const localA2UIChoices = Object.freeze([
  Object.freeze({ label: '첫 번째 항목', value: 'first' }),
  Object.freeze({ label: '두 번째 항목', value: 'second' }),
] as const);

export const localA2UIDraftFieldLabel = '이 화면에서만 쓰는 메모';
export const localA2UIDraftResetLabel = '메모 지우기';
export const localA2UIDraftPath = '/local/draft';
export const localA2UIDraftResetAction = 'orot:reset-local-draft';

/** Only final verified, visible nodes may be supplied. The app chooses all
 * labels, the only editable path and the only handler; model strings do not
 * become native behavior or leave this mounted draft. */
export type ConversationA2UILocalDraft =
  | Readonly<{ fieldId: string; resetId: string; kind?: never }>
  | Readonly<{ fieldId: string; kind: 'checkbox' | 'choice' }>;

export function mountConversationA2UILocalDraft(
  approved: ConversationA2UILocalDraft,
  surfaceId: string,
  isCurrent: () => boolean,
) {
  const owner = {};
  const { fieldId } = approved;
  const checkbox = approved.kind === 'checkbox';
  const choice = approved.kind === 'choice';
  const resetId = approved.kind === undefined ? approved.resetId : undefined;
  const store = createConversationA2UIInteractions({
    owner,
    surfaceId,
    renderedComponentIds: new Set(resetId ? [fieldId, resetId] : [fieldId]),
    allowedActionNames: new Set(resetId ? [localA2UIDraftResetAction] : []),
    fields: [
      {
        componentId: fieldId,
        path: checkbox
          ? localA2UICheckPath
          : choice
            ? localA2UIChoicePath
            : localA2UIDraftPath,
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
      // Protocol [] or a single choice is projected into this scalar store.
      // No model string, arbitrary value, or user text can become a choice.
      return (
        componentId === fieldId &&
        (!choice ||
          value === '' ||
          localA2UIChoices.some(option => option.value === value)) &&
        store.write(field, value)
      );
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
