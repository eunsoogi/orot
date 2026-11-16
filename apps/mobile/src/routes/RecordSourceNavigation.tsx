import type { AppRouteContentProps } from './AppProps';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { RecordingSelectionProvider } from '../recording/RecordingSelectionContext';

const Context = createContext<{
  readonly sources: ReadonlyMap<string, string>;
  readonly select: (routeKey: string, sourceId: string) => void;
} | null>(null);

/** Retain only source IDs per native route; document contents are read locally by their destination. */
export function RecordSourceNavigationProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const value = useMemo(
    () => ({
      sources,
      select: (routeKey: string, sourceId: string) => {
        setSources(current => new Map(current).set(routeKey, sourceId));
      },
    }),
    [sources],
  );
  return (
    <Context.Provider value={value}>
      <RecordingSelectionProvider>{children}</RecordingSelectionProvider>
    </Context.Provider>
  );
}

export function useRecordSourceNavigation(
  actions: AppRouteContentProps['actions'],
) {
  const sources = useContext(Context);
  return {
    sourceId: sources?.sources.get(actions.route.key),
    openMemory: sources
      ? (memoryId: string) => {
          const route = actions.push('saved-memory-detail');
          if (route) sources.select(route.key, memoryId);
        }
      : undefined,
    openDocument: sources
      ? (sourceId: string) => {
          const route = actions.push('medical-document-detail');
          if (route) sources.select(route.key, sourceId);
        }
      : undefined,
  };
}
