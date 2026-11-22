import { localQueryTimestampKey } from '@orot/storage';
import type { MedicalDocumentSourceRecord } from '../medicalDocuments/medicalDocumentImportService';
import { t } from '../i18n';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import type { RecentMediaRow } from './recentSourceReader';
import type { RecentMaterialRow } from '../generatedReports/catalog';
import { recentMaterialTimestamp } from '../generatedReports/recentMaterialTimestamp';
import { generatedReportCopy } from '../generatedReports/text';

export const recentPageSize = 20;

export type RecentRecordKind =
  'recording' | 'medical_document' | 'generated_report' | 'saved_memory';

export interface RecentRecordEntry {
  readonly id: string;
  readonly kind: RecentRecordKind;
  readonly timestamp: string;
  readonly title: string;
  readonly summary?: string;
  readonly documentIndex?: number;
  readonly material?: RecentMaterialRow;
  readonly source?: RecentMediaRow;
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
  material: readonly RecentMaterialRow[] = [],
  sources: readonly RecentMediaRow[] = [],
): RecentRecordEntry[] {
  let nextDocumentIndex = 0;
  const records: RecentRecordEntry[] = [
    ...recordings.map(recording => ({
      id: recording.id,
      kind: 'recording' as const,
      timestamp: recording.recordedAt,
      title: recording.title ?? t('recording.library.untitled'),
    })),
    ...documents.map((document, documentIndex) => ({
      documentIndex,
      id: document.id,
      kind: 'medical_document' as const,
      timestamp: document.ingestedAt,
      title: t('records.recent.medicalDocument'),
      summary: document.title ?? t('medicalDocument.source.untitled'),
    })),
    ...sources.map(source => {
      const isRecording = source.kind === 'audio_recording';
      return {
        id: source.id,
        kind: isRecording
          ? ('recording' as const)
          : ('medical_document' as const),
        timestamp: source.createdAt,
        title: isRecording
          ? (source.title ?? t('recording.library.untitled'))
          : t('records.recent.medicalDocument'),
        summary: isRecording
          ? undefined
          : (source.title ?? t('medicalDocument.source.untitled')),
        documentIndex: isRecording ? undefined : nextDocumentIndex++,
        source,
      };
    }),
    ...material
      .filter(row => row.origin === 'memory' || !row.unavailable)
      .map(row => ({
        id: row.key,
        kind:
          row.origin === 'memory'
            ? ('saved_memory' as const)
            : ('generated_report' as const),
        timestamp: recentMaterialTimestamp(row.createdAt),
        title:
          row.origin === 'memory'
            ? t('savedMemory.title')
            : generatedReportCopy[row.kind],
        material: row,
      })),
  ];
  return [
    ...new Map(records.map(row => [`${row.kind}:${row.id}`, row])).values(),
  ]
    .map(row => ({ row, order: position(row) }))
    .sort((left, right) => compareRecentPosition(left.order, right.order))
    .map(({ row }) => row);
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

interface RecentPosition {
  readonly instant: string;
  readonly key: string;
}

interface RecentFrontier {
  readonly more: boolean;
  readonly tail?: RecentPosition;
}

export function recentStreamFrontier(
  stream: {
    readonly more: boolean;
    readonly rows: readonly { key: string; createdAt: string }[];
  },
  namespace: 'material' | 'source',
): RecentFrontier {
  const tail = stream.rows.at(-1);
  return {
    more: stream.more,
    tail: tail && {
      instant: instantKey(recentMaterialTimestamp(tail.createdAt)),
      key: namespace + ':' + tail.key,
    },
  };
}

function position(row: RecentRecordEntry): RecentPosition {
  const key = row.material
    ? 'material:' + row.material.key
    : row.source
      ? 'source:' + row.source.key
      : row.kind + ':' + row.id;
  return { instant: instantKey(row.timestamp), key };
}

/** An unseen row can be newer than another stream's tail, never newer than its own. */
export function certifiedRecentPrefix(
  sorted: readonly RecentRecordEntry[],
  streams: readonly RecentFrontier[],
): readonly RecentRecordEntry[] {
  let newestBoundary: RecentPosition | undefined;
  for (const { more, tail } of streams) {
    if (!more) continue;
    if (!tail || !tail.instant) return [];
    if (!newestBoundary || compareRecentPosition(tail, newestBoundary) < 0)
      newestBoundary = tail;
  }
  if (!newestBoundary) return sorted;
  const boundary = newestBoundary;
  const beyond = sorted.findIndex(
    row => compareRecentPosition(position(row), boundary) > 0,
  );
  return beyond === -1 ? sorted : sorted.slice(0, beyond);
}

function instantKey(timestamp: string) {
  return Number.isFinite(Date.parse(timestamp))
    ? localQueryTimestampKey(timestamp)
    : '';
}

function compareRecentPosition(left: RecentPosition, right: RecentPosition) {
  if (left.instant !== right.instant)
    return left.instant > right.instant ? -1 : 1;
  return compareBinaryKey(right.key, left.key);
}

/** SQLite BINARY orders stored UTF-8 by scalar value, unlike JS's UTF-16 string order. */
function compareBinaryKey(left: string, right: string): number {
  if (left === right) return 0;
  const compare = right[Symbol.iterator]();
  for (const unit of left) {
    const next = compare.next();
    if (next.done) return 1;
    const difference =
      (unit.codePointAt(0) ?? 0) - (next.value.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return -1;
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
      : t('historyDisplay.yearDate', {
          year: date.getFullYear(),
          date: monthAndDay,
        });

  if (localDayKey(date) === todayKey) {
    return t('records.recent.today', { date: visibleDate });
  }
  if (localDayKey(date) === yesterdayKey) {
    return t('records.recent.yesterday', { date: visibleDate });
  }
  return visibleDate;
}
