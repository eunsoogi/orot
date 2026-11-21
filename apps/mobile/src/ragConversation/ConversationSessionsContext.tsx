import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { createConversationSessions } from './conversationSessions';
import type { ConversationSessions } from './conversationSessions';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import type { ConversationSessionOptions } from './conversationSessionTypes';

export type SubscribeRootConversationVisibility = (
  listener: (visible: boolean) => void,
) => () => void;

const Context = createContext<ConversationSessions | null>(null);
/** One app lifetime owns conversations; route components only subscribe. */
export function ConversationSessionsProvider({
  children,
  options,
  subscribeRootConversationVisibility,
}: {
  children: ReactNode;
  options?: ConversationSessionOptions;
  subscribeRootConversationVisibility?: SubscribeRootConversationVisibility;
}) {
  // Standalone callers retain memory-only behavior; the app owner supplies durable options.
  const [store] = useState(() => createConversationSessions(options));
  useLayoutEffect(
    () =>
      subscribeRootConversationVisibility?.(store.setRootConversationVisible),
    [store, subscribeRootConversationVisibility],
  );
  useEffect(() => subscribeLocalDataClear(store.invalidateAll), [store]);
  useEffect(
    () => subscribeLocalSourceDeletion(store.refreshAfterSourceDeletion),
    [store],
  );
  useEffect(() => () => store.dispose(), [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useConversationSessions() {
  const retained = useContext(Context);
  const [local] = useState(createConversationSessions);
  useEffect(() => subscribeLocalDataClear(local.invalidateAll), [local]);
  useEffect(
    () => subscribeLocalSourceDeletion(local.refreshAfterSourceDeletion),
    [local],
  );
  useEffect(() => () => local.dispose(), [local]);
  return retained ?? local;
}
