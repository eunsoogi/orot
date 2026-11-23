import type {
  GeneratedReportCitationSelection,
  GeneratedReportRow,
} from '../generatedReports/types';
import type { AppRouteContentProps } from './AppProps';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import {
  RecordingSelectionProvider,
  useOptionalRecordingSelection,
} from '../recording/RecordingSelectionContext';

const Context = createContext<{
  readonly sources: ReadonlyMap<string, string>;
  readonly select: (routeKey: string, sourceId: string) => void;
  readonly report: { routeKey: string; row: GeneratedReportRow } | null;
  readonly selectReport: (selection: {
    routeKey: string;
    row: GeneratedReportRow;
  }) => void;
  readonly reportSource: {
    routeKey: string;
    selected: GeneratedReportCitationSelection;
  } | null;
  readonly selectReportSource: (value: {
    routeKey: string;
    selected: GeneratedReportCitationSelection;
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
  const [reportSource, selectReportSource] = useState<{
    routeKey: string;
    selected: GeneratedReportCitationSelection;
  } | null>(null);
  const value = useMemo(
    () => ({
      sources,
      report,
      selectReport,
      reportSource,
      selectReportSource,
      select: (routeKey: string, sourceId: string) => {
        setSources(current => new Map(current).set(routeKey, sourceId));
      },
    }),
    [report, reportSource, sources],
  );
  return (
    <Context.Provider value={value}>
      <RecordingSelectionProvider>{children}</RecordingSelectionProvider>
    </Context.Provider>
  );
}

export function useRecordNav(
  actions: AppRouteContentProps['actions'],
  active: boolean,
  recordsTabAuthority: AppRouteContentProps['recordsTabAuthority'],
) {
  const sources = useContext(Context);
  const recording = useOptionalRecordingSelection();
  const isCurrent = () => active && (actions.ownership?.isCurrent() ?? true);
  return {
    active,
    recordsTabAuthority,
    ownership: actions.ownership,
    openRecentRecording(source: RecordingSourceRecord) {
      if (!recording || !isCurrent()) return;
      const route = actions.push('recording-review');
      if (!route) return;
      // The exact saved identity opens the existing local viewer without starting playback.
      recording.select({
        summary: {
          source,
          durationMs: source.recordingDurationMs ?? null,
          transcriptReviewState: 'unavailable',
        },
        autoPlay: false,
        recentRouteKey: route.key,
      });
    },
    sourceId: sources?.sources.get(actions.route.key),
    report:
      sources?.report?.routeKey === actions.route.key
        ? sources.report.row
        : undefined,
    reportSource:
      sources?.reportSource?.routeKey === actions.route.key
        ? sources.reportSource.selected
        : undefined,
    openReportSource:
      sources && actions.route.name === 'generated-report-detail'
        ? (selection: GeneratedReportCitationSelection) => {
            if (!isCurrent()) return false;
            const route = actions.push('generated-report-source');
            if (!route) return false;
            const { sessionId, sessionVersion, turnId, createdAt } =
              selection.target;
            sources.selectReportSource({
              routeKey: route.key,
              selected: {
                target: { sessionId, sessionVersion, turnId, createdAt },
                ordinal: selection.ordinal,
              },
            });
            return true;
          }
        : undefined,
    openReport:
      sources &&
      ['generated-reports', 'root', 'recent-records'].includes(
        actions.route.name,
      )
        ? (row: GeneratedReportRow) => {
            if (!isCurrent()) return false;
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
          if (!isCurrent()) return;
          const route = actions.push('saved-memory-detail');
          if (route) sources.select(route.key, memoryId);
        }
      : undefined,
    openDocument: sources
      ? (sourceId: string) => {
          if (!isCurrent()) return;
          const route = actions.push('medical-document-detail');
          if (route) sources.select(route.key, sourceId);
        }
      : undefined,
  };
}
