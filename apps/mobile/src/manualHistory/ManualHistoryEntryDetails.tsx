import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import type { ManualHistoryScreenRecord } from './types';

interface ManualHistoryEntryDetailsProps {
  entry: ManualHistoryScreenRecord;
  history: readonly ManualHistoryScreenRecord[];
  onCorrect: () => void;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
  deleting: boolean;
}

function kindLabel(kind: ManualHistoryScreenRecord['kind']): string {
  return t(
    ('manualHistory.kind.' +
      kind) as `manualHistory.kind.${ManualHistoryScreenRecord['kind']}`,
  );
}

function effectiveDateLabel(
  value: ManualHistoryScreenRecord['effectiveDate'],
): string {
  return value.status === 'known'
    ? t('manualHistory.date.known', { date: value.date })
    : t('manualHistory.date.unknown');
}

function reviewLabel(entry: ManualHistoryScreenRecord): string {
  return t(
    ('manualHistory.review.' + entry.reviewState.status) as
      | 'manualHistory.review.unreviewed'
      | 'manualHistory.review.needs_review'
      | 'manualHistory.review.reviewed',
  );
}

function recordedAtLabel(recordedAt: string): string {
  return t('manualHistory.detail.recordedAt', {
    date: new Date(recordedAt).toLocaleString(),
  });
}

/** Makes deletion a separate, explicit action because it removes the full correction lineage. */
export default function ManualHistoryEntryDetails({
  entry,
  history,
  onCorrect,
  onClose,
  onDelete,
  deleting,
}: ManualHistoryEntryDetailsProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <View style={styles.container} testID="manual-history-detail">
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {t('manualHistory.detail.title')}
      </Text>
      <Text style={styles.entryTitle}>{entry.title}</Text>
      <Text>{kindLabel(entry.kind)}</Text>
      <Text testID="manual-history-date-detail">
        {effectiveDateLabel(entry.effectiveDate)}
      </Text>
      <Text>{entry.details}</Text>
      {history.length <= 1 ? (
        <Text>{t('manualHistory.status', { review: reviewLabel(entry) })}</Text>
      ) : null}
      {history.length > 1 ? (
        <View style={styles.history} testID="manual-history-correction-history">
          <Text style={styles.sectionTitle}>
            {t('manualHistory.detail.correctionHistory')}
          </Text>
          {history.map((version, index) => (
            <View
              key={version.id}
              style={styles.version}
              testID={'manual-history-version-' + version.id}
            >
              <Text>
                {index === history.length - 1
                  ? t('manualHistory.detail.currentVersion')
                  : t('manualHistory.detail.earlierVersion')}
              </Text>
              <Text>{kindLabel(version.kind)}</Text>
              <Text>
                {t('manualHistory.status', { review: reviewLabel(version) })}
              </Text>
              <Text testID="manual-history-recorded-at">
                {recordedAtLabel(version.recordedAt)}
              </Text>
              <Text style={styles.entryTitle}>{version.title}</Text>
              <Text testID={'manual-history-date-version-' + version.id}>
                {effectiveDateLabel(version.effectiveDate)}
              </Text>
              <Text>{version.details}</Text>
              {version.correctionNote ? (
                <Text>
                  {t('manualHistory.detail.correctionNote', {
                    note: version.correctionNote,
                  })}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <Button
        onPress={onCorrect}
        testID="manual-history-correct"
        title={t('manualHistory.detail.correct')}
      />
      {!confirmDelete ? (
        <Button
          disabled={deleting}
          onPress={() => setConfirmDelete(true)}
          testID="manual-history-delete"
          title={t('manualHistory.detail.delete')}
        />
      ) : (
        <View
          style={styles.confirmation}
          testID="manual-history-delete-confirmation"
        >
          <Text>{t('manualHistory.detail.confirmDelete')}</Text>
          <Button
            disabled={deleting}
            onPress={onDelete}
            testID="manual-history-confirm-delete"
            title={t('manualHistory.detail.confirmDeleteAction')}
          />
          <Button
            disabled={deleting}
            onPress={() => setConfirmDelete(false)}
            testID="manual-history-cancel-delete"
            title={t('manualHistory.detail.cancelDelete')}
          />
        </View>
      )}
      <Button
        onPress={onClose}
        testID="manual-history-close-details"
        title={t('manualHistory.detail.close')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    borderRadius: 10,
    gap: 8,
    padding: 14,
  },
  sectionTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  entryTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  history: { gap: 8, paddingTop: 8 },
  version: {
    borderLeftColor: '#a8b3bf',
    borderLeftWidth: 2,
    gap: 6,
    paddingLeft: 10,
  },
  confirmation: {
    backgroundColor: '#fff4e8',
    borderRadius: 8,
    gap: 8,
    padding: 12,
  },
});
