import { createContext, useContext } from 'react';

/** Presentation only: never changes the session or dispatch lifecycle. */
export const SeparatedConversationActivity = createContext(false);
export const useSeparatedConversationActivity = () =>
  useContext(SeparatedConversationActivity);
