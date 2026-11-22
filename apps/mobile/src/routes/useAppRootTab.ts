import { useCallback, useRef, useState } from 'react';
import type { AppRootTab } from '../navigation/rootTabs';

export function useAppRootTab() {
  const [activeTab, setActiveTab] = useState<AppRootTab>('conversation');
  const activeTabRef = useRef(activeTab);
  const revision = useRef(0);
  const conversationVisibility = useRef(new Set<(visible: boolean) => void>());
  const subscribeRootConversationVisibility = useCallback(
    (listener: (visible: boolean) => void) => {
      conversationVisibility.current.add(listener);
      listener(activeTabRef.current === 'conversation');
      return () => {
        conversationVisibility.current.delete(listener);
      };
    },
    [],
  );
  const selectActiveTab = useCallback((tab: AppRootTab) => {
    const previous = activeTabRef.current;
    if (previous !== tab) revision.current += 1;
    activeTabRef.current = tab;
    // Root intent is synchronous; a pre-commit scene can still finish a read.
    if ((previous === 'conversation') !== (tab === 'conversation'))
      for (const listener of conversationVisibility.current)
        listener(tab === 'conversation');
    setActiveTab(tab);
  }, []);
  const capturePromptTab = useCallback(() => {
    const prior = revision.current;
    return () =>
      activeTabRef.current === 'conversation' && revision.current === prior;
  }, []);
  return {
    activeTab,
    activeTabRef,
    selectActiveTab,
    capturePromptTab,
    subscribeRootConversationVisibility,
  };
}
