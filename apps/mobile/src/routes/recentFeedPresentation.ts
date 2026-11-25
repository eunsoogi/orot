import { t } from '../i18n';
import {
  certifiedRecentPrefix,
  recentStreamFrontier,
  type RecentRecordEntry,
} from './RecordsRecentTimeline';
import type {
  RecentPageRow,
  RecentPageState,
} from './requestRecentSavedMaterialPage';

export function recentStreamHasError(state: RecentPageState) {
  return state === 'failed' || state === 'refused';
}

interface RecentFeedStream {
  readonly state: RecentPageState;
  readonly more: boolean;
  readonly rows: readonly RecentPageRow[];
}

function missingFailedFrontier(stream: RecentFeedStream | undefined) {
  return stream?.state === 'failed' && stream.more && stream.rows.length === 0;
}

/** An unresolved live cursor can hide newer rows. An admitted read failure
 * instead shows the other verified rows with Retry, not as a paging frontier. */
export function describeRecentFeed(
  records: readonly RecentRecordEntry[],
  {
    reports,
    media,
    legacyRecordingFailed,
    legacyDocumentFailed,
    documentsError,
  }: {
    readonly reports: RecentFeedStream | undefined;
    readonly media: RecentFeedStream | undefined;
    readonly legacyRecordingFailed: boolean;
    readonly legacyDocumentFailed: boolean;
    readonly documentsError: string | null;
  },
) {
  const reportsMissing = missingFailedFrontier(reports);
  const mediaMissing = missingFailedFrontier(media);
  return {
    partial: reportsMissing || mediaMissing,
    certified: certifiedRecentPrefix(records, [
      ...(reports && !reportsMissing
        ? [recentStreamFrontier(reports, 'material')]
        : []),
      ...(media && !mediaMissing
        ? [recentStreamFrontier(media, 'source')]
        : []),
    ]),
    loadErrors: [
      reports && recentStreamHasError(reports.state)
        ? t('records.recent.savedMaterialLoadError')
        : null,
      media && recentStreamHasError(media.state)
        ? t('records.recent.loadError')
        : null,
      legacyRecordingFailed ? t('recording.library.loadError') : null,
      legacyDocumentFailed
        ? (documentsError ?? t('medicalDocument.source.loadError'))
        : null,
    ].filter((message): message is string => message !== null),
  };
}
