import type { RecentMaterialRow } from '../generatedReports/catalog';
import type { RecordsRecentSourcesProps } from './RecordsRecentSources';
import type { RecentRecordEntry } from './RecordsRecentTimeline';
import {
  readSelectedRecentRecording,
  type RecentMediaRow,
} from './recentSourceReader';
import type { useRecentSavedMaterial } from './useRecentSavedMaterial';

export function openRecentRecord(
  record: RecentRecordEntry,
  props: RecordsRecentSourcesProps,
  reports: ReturnType<typeof useRecentSavedMaterial<RecentMaterialRow>>,
  media: ReturnType<typeof useRecentSavedMaterial<RecentMediaRow>>,
) {
  const {
    recordings,
    onOpenMedicalDocument,
    onOpenRecording,
    onOpenMemory,
    onOpenReport,
    onOpenSavedRecordings,
  } = props;
  if (!reports.isRouteCurrent()) return;
  if (record.source) {
    media.open(record.source, async (row, revalidate, current) => {
      if (row.kind === 'medical_document') {
        onOpenMedicalDocument(row.id);
        return;
      }
      // Only one user-selected recording re-enters the exact existing detail owner.
      try {
        const source = await readSelectedRecentRecording(row.id);
        if (source && (await revalidate()) && current())
          onOpenRecording?.(source);
      } catch {
        // A failed local read must not open another recording or trigger playback.
      }
    });
  } else if (record.material) {
    reports.open(record.material, item => {
      if (item.origin === 'memory') onOpenMemory?.(item.id);
      else onOpenReport?.(item);
    });
  } else if (record.kind === 'medical_document') {
    onOpenMedicalDocument(record.id);
  } else {
    const source = recordings.find(row => row.id === record.id);
    if (source && onOpenRecording) onOpenRecording(source);
    else onOpenSavedRecordings();
  }
}
