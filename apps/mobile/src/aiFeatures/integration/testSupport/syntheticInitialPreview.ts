import { ragConversationTask } from '../../../ragConversation/task';
import { initialConversationResponse } from '../../../ragConversation/initialResponse';

/** Test-only exact copy preserves the preview/replay assertion in both fresh factories.
 * Restore the same module policy after each case; production remains opted out. */
export function enableSyntheticInitialPreview() {
  const previous = Object.getOwnPropertyDescriptor(
    ragConversationTask,
    'initialToolResponse',
  );
  Object.defineProperty(ragConversationTask, 'initialToolResponse', {
    configurable: true,
    value: (text: string) =>
      text === initialConversationResponse ? text : undefined,
  });
  return () => {
    if (previous)
      Object.defineProperty(
        ragConversationTask,
        'initialToolResponse',
        previous,
      );
    else Reflect.deleteProperty(ragConversationTask, 'initialToolResponse');
  };
}
