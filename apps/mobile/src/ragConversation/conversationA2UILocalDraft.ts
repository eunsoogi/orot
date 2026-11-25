import { createConversationA2UIInteractions } from './conversationA2UIInteractions';

export const localA2UIDraftFieldLabel = '이 화면에서만 쓰는 메모';
export const localA2UIDraftResetLabel = '메모 지우기';
export const localA2UIDraftPath = '/local/draft';
export const localA2UIDraftResetAction = 'orot:reset-local-draft';

/** Only final verified, visible nodes may be supplied. The app chooses all
 * labels, the only editable path and the only handler; model strings do not
 * become native behavior or leave this mounted draft. */
export interface ConversationA2UILocalDraft {
  readonly fieldId: string;
  readonly resetId: string;
}

export function mountConversationA2UILocalDraft(
  approved: ConversationA2UILocalDraft,
  surfaceId: string,
  isCurrent: () => boolean,
) {
  const owner = {};
  const { fieldId, resetId } = approved;
  const store = createConversationA2UIInteractions({
    owner,
    surfaceId,
    renderedComponentIds: new Set([fieldId, resetId]),
    allowedActionNames: new Set([localA2UIDraftResetAction]),
    fields: [
      {
        componentId: fieldId,
        path: localA2UIDraftPath,
        kind: 'text',
        initial: '',
      },
    ],
    events: [
      { componentId: resetId, name: localA2UIDraftResetAction, context: [] },
    ],
    isCurrent,
  });
  if (!store) return undefined;
  const field = { owner, surfaceId, componentId: fieldId };
  const reset = { owner, surfaceId, componentId: resetId };
  return {
    change(componentId: string, value: string) {
      return componentId === fieldId && store.write(field, value);
    },
    reset(componentId: string) {
      if (componentId !== resetId) return false;
      const receipt = store.prepareAction(reset, localA2UIDraftResetAction);
      return Boolean(
        receipt && store.consumeAction(reset, receipt) && store.revert(field),
      );
    },
    read(componentId: string) {
      const result = componentId === fieldId ? store.read(field) : undefined;
      return typeof result === 'string' ? result : undefined;
    },
    retire: store.retire,
  };
}
