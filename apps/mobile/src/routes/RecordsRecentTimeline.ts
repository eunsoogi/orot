import type { MedicalDocumentSourceRecord } from '../medicalDocuments/medicalDocumentImportService';
import { t } from '../i18n';
import type { RecordingSourceRecord } from '../recording/recordingTypes';

export type RecentRecordKind = 'recording' | 'medical_document';

export interface RecentRecordEntry {
  readonly id: string;
  readonly kind: RecentRecordKind;
  readonly timestamp: string;
  readonly title: string;
  readonly summary?: string;
}

export interface RecentRecordGroup {
  readonly key: string;
  readonly label: string;
  readonly records: readonly RecentRecordEntry[];
}

/** Projects existing local records into one feed; dates follow when each record was captured or imported. */
export function buildRecentRecordEntries(
  recordings: readonly RecordingSourceRecord[],
  documents: readonly MedicalDocumentSourceRecord[],
): RecentRecordEntry[] {
  return [
    ...recordings.map(recording => ({
      id: recording.id,
      kind: 'recording' as const,
      timestamp: recording.recordedAt,
      title: recording.title ?? t('recording.library.untitled'),
    })),
    ...documents.map(document => ({
      id: document.id,
      kind: 'medical_document' as const,
      timestamp: document.ingestedAt,
      title: t('records.recent.medicalDocument'),
      summary: document.title ?? t('medicalDocument.source.untitled'),
    })),
  ].sort(compareRecency);
}

/** Groups by device-local day and optionally limits the collapsed feed to its newest entries. */
export function groupRecentRecords(
  records: readonly RecentRecordEntry[],
  now: Date,
  limit: number | null = 3,
): RecentRecordGroup[] {
  const visible = limit === null ? records : records.slice(0, limit);
  const groups = new Map<
    string,
    { date: Date | null; records: RecentRecordEntry[] }
  >();

  for (const record of visible) {
    const date = new Date(record.timestamp);
    const validDate = Number.isNaN(date.getTime()) ? null : date;
    const key = validDate ? localDayKey(validDate) : 'unknown';
    const group = groups.get(key) ?? { date: validDate, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }

  const todayKey = localDayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDayKey(yesterday);

  return [...groups].map(([key, group]) => ({
    key,
    label: group.date
      ? formatGroupLabel(group.date, todayKey, yesterdayKey, now.getFullYear())
      : t('records.recent.unknownDate'),
    records: group.records,
  }));
}

export function formatRecentTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

function compareRecency(
  left: RecentRecordEntry,
  right: RecentRecordEntry,
): number {
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (!Number.isFinite(leftTime)) return Number.isFinite(rightTime) ? 1 : 0;
  if (!Number.isFinite(rightTime)) return -1;
  return rightTime - leftTime || left.id.localeCompare(right.id);
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function formatGroupLabel(
  date: Date,
  todayKey: string,
  yesterdayKey: string,
  currentYear: number,
): string {
  const monthAndDay = date.toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
  });
  const visibleDate =
    date.getFullYear() === currentYear
      ? monthAndDay
      : `${date.getFullYear()}년 ${monthAndDay}`;

  if (localDayKey(date) === todayKey) {
    return t('records.recent.today', { date: visibleDate });
  }
  if (localDayKey(date) === yesterdayKey) {
    return t('records.recent.yesterday', { date: visibleDate });
  }
  return visibleDate;
}
