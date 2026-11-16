import { createConversationTaskRefresh } from './conversationTaskRefresh';
import { createConversationTaskState } from './conversationTaskState';
import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';

/** Shared task owners keep retained task state and source refresh on the same session fences. */
export function createConversationTasks(input: {
  options: ConversationSessionOptions;
  find: (id: number) => ConversationSession | undefined;
  update: (id: number, change: Partial<ConversationSession>) => void;
  valid: () => boolean;
  activeId: () => number;
}) {
  return {
    taskRefresh: createConversationTaskRefresh(input),
    taskState: createConversationTaskState({
      ...input,
      retention: input.options.retention,
    }),
  };
}
