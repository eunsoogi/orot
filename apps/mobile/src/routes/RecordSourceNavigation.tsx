import type { GeneratedReportRow } from '../generatedReports/types';
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
  readonly report: { routeKey: string; row: GeneratedReportRow } | null;
  readonly selectReport: (selection: {
    routeKey: string;
    row: GeneratedReportRow;
  }) => void;
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
  // Retain only the latest row's metadata, never its protected body.
  const [report, selectReport] = useState<{
    routeKey: string;
    row: GeneratedReportRow;
  } | null>(null);
  const value = useMemo(
    () => ({
      sources,
      report,
      selectReport,
      select: (routeKey: string, sourceId: string) => {
        setSources(current => new Map(current).set(routeKey, sourceId));
      },
    }),
    [report, sources],
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
    report:
      sources?.report?.routeKey === actions.route.key
        ? sources.report.row
        : undefined,
    openReport:
      sources && actions.route.name === 'generated-reports'
        ? (row: GeneratedReportRow) => {
            if (actions.ownership && !actions.ownership.isCurrent())
              return false;
            const route = actions.push('generated-report-detail');
            if (!route) return false;
            const { key, id, origin, kind, createdAt, unavailable } = row;
            sources.selectReport({
              routeKey: route.key,
              row: { key, id, origin, kind, createdAt, unavailable },
            });
            return true;
          }
        : undefined,
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
