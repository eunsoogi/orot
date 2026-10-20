import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createConversationSessions } from './conversationSessions';
import type { ConversationSessions } from './conversationSessions';

const Context = createContext<ConversationSessions | null>(null);
/** One app lifetime owns conversations; route components only subscribe. */
export function ConversationSessionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [store] = useState(createConversationSessions);
  useEffect(() => () => store.dispose(), [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useConversationSessions() {
  const retained = useContext(Context);
  const [local] = useState(createConversationSessions);
  useEffect(() => () => local.dispose(), [local]);
  return retained ?? local;
}
