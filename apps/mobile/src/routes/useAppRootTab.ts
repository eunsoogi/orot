import { useCallback, useRef, useState } from 'react';
import type { AppRootTab } from '../navigation/rootTabs';

export function useAppRootTab() {
  const [activeTab, setActiveTab] = useState<AppRootTab>('conversation');
  const activeTabRef = useRef(activeTab);
  const revision = useRef(0);
  const selectActiveTab = useCallback((tab: AppRootTab) => {
    if (activeTabRef.current !== tab) revision.current += 1;
    activeTabRef.current = tab;
    setActiveTab(tab);
  }, []);
  const capturePromptTab = useCallback(() => {
    const prior = revision.current;
    return () =>
      activeTabRef.current === 'conversation' && revision.current === prior;
  }, []);
  return { activeTab, activeTabRef, selectActiveTab, capturePromptTab };
}
