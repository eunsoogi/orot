import { Button, Text } from 'react-native';
import { t } from '../i18n';
import { ManualHistoryEntryCard } from './ManualHistoryEntryCard';
import ManualHistoryEntryDetails from './ManualHistoryEntryDetails';
import type { ManualHistoryScreenRecord } from './types';

interface ManualHistoryEntryBrowserProps {
  readonly entries: readonly ManualHistoryScreenRecord[];
  readonly errorWithoutEntries: boolean;
  readonly history: readonly ManualHistoryScreenRecord[];
  readonly loading: boolean;
  readonly selectedEntry: ManualHistoryScreenRecord | null;
  readonly deleting: boolean;
  readonly onRetry: () => void;
  readonly onOpenDetails: (entry: ManualHistoryScreenRecord) => void;
  readonly onCloseDetails: () => void;
  readonly onCorrect: () => void;
  readonly onDelete: () => void;
}

/** Renders current entries and their preserved correction history. */
export function ManualHistoryEntryBrowser({
  entries,
  errorWithoutEntries,
  history,
  loading,
  selectedEntry,
  deleting,
  onRetry,
  onOpenDetails,
  onCloseDetails,
  onCorrect,
  onDelete,
}: ManualHistoryEntryBrowserProps) {
  return (
    <>
      {loading ? (
        <Text testID="manual-history-loading">
          {t('manualHistory.loading')}
        </Text>
      ) : errorWithoutEntries ? (
        <Button
          onPress={onRetry}
          testID="manual-history-retry"
          title={t('manualHistory.retry')}
        />
      ) : entries.length === 0 ? (
        <Text testID="manual-history-empty">{t('manualHistory.empty')}</Text>
      ) : (
        entries.map(entry => (
          <ManualHistoryEntryCard
            key={entry.id}
            entry={entry}
            onOpenDetails={() => onOpenDetails(entry)}
          />
        ))
      )}
      {selectedEntry ? (
        <ManualHistoryEntryDetails
          entry={selectedEntry}
          history={history}
          onClose={onCloseDetails}
          onCorrect={onCorrect}
          onDelete={onDelete}
          deleting={deleting}
        />
      ) : null}
    </>
  );
}
