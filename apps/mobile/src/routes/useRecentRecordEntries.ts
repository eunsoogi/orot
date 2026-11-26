import { useMemo } from 'react';
import type { RecentMaterialRow } from '../generatedReports/catalog';
import type { RecordsRecentSourcesProps } from './RecordsRecentSources';
import { buildRecentRecordEntries } from './RecordsRecentTimeline';
import type { RecentMediaRow } from './recentSourceReader';

export function useRecentRecordEntries(
  {
    pagedAudio,
    pagedDocuments,
    documents,
    recordings,
  }: RecordsRecentSourcesProps,
  mediaRows: readonly RecentMediaRow[],
  materialRows: readonly RecentMaterialRow[],
) {
  return useMemo(
    () =>
      buildRecentRecordEntries(
        pagedAudio ? [] : recordings,
        pagedDocuments ? [] : documents,
        materialRows,
        mediaRows.filter(row =>
          row.kind === 'audio_recording' ? pagedAudio : pagedDocuments,
        ),
      ),
    [
      documents,
      mediaRows,
      pagedAudio,
      pagedDocuments,
      recordings,
      materialRows,
    ],
  );
}
