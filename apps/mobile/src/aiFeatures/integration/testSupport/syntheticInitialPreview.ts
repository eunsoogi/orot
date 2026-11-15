import { ragConversationTask } from '../../../ragConversation/task';
import { initialConversationResponse } from '../../../ragConversation/initialResponse';

/** Test-only exact copy preserves the preview/replay assertion in both fresh factories.
 * Restore the same module policy after each case; this legacy test policy never invokes the contextual reviewer. */
export function enableSyntheticInitialPreview() {
  const review = Object.getOwnPropertyDescriptor(
    ragConversationTask,
    'reviewInitialToolResponse',
  );
  Object.defineProperty(ragConversationTask, 'reviewInitialToolResponse', {
    configurable: true,
    value: false,
  });
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
    if (review)
      Object.defineProperty(
        ragConversationTask,
        'reviewInitialToolResponse',
        review,
      );
    else
      Reflect.deleteProperty(ragConversationTask, 'reviewInitialToolResponse');
    if (previous)
      Object.defineProperty(
        ragConversationTask,
        'initialToolResponse',
        previous,
      );
    else Reflect.deleteProperty(ragConversationTask, 'initialToolResponse');
  };
}
