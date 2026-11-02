import { t } from '../i18n';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import type { RecordingSourceRecord } from '../recording/recordingTypes';

export interface RecentRecordingGroup {
  readonly key: string;
  readonly label: string;
  readonly recordings: readonly RecordingSourceRecord[];
}

/** Groups the newest loaded recordings by the same device-local calendar date as their displayed times. */
export function groupRecentRecordings(
  recordings: readonly RecordingSourceRecord[],
  now: Date,
): RecentRecordingGroup[] {
  const groups = new Map<
    string,
    { date: Date | null; recordings: RecordingSourceRecord[] }
  >();
  const newest = [...recordings].sort(compareRecordingRecency).slice(0, 3);

  for (const recording of newest) {
    const date = new Date(recording.recordedAt);
    const validDate = Number.isNaN(date.getTime()) ? null : date;
    const key = validDate ? localDayKey(validDate) : 'unknown';
    const group = groups.get(key) ?? { date: validDate, recordings: [] };
    group.recordings.push(recording);
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
    recordings: group.recordings,
  }));
}

export function formatRecentTime(recordedAt: string): string {
  const date = new Date(recordedAt);
  return Number.isNaN(date.getTime())
    ? formatRecordedAt(recordedAt)
    : date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

function compareRecordingRecency(
  left: RecordingSourceRecord,
  right: RecordingSourceRecord,
): number {
  const leftTime = Date.parse(left.recordedAt);
  const rightTime = Date.parse(right.recordedAt);
  if (!Number.isFinite(leftTime)) return Number.isFinite(rightTime) ? 1 : 0;
  if (!Number.isFinite(rightTime)) return -1;
  return rightTime - leftTime;
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
