import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { ManualHistoryScreenRecord } from './types';

interface ManualHistoryEntryDetailsProps {
  entry: ManualHistoryScreenRecord;
  history: readonly ManualHistoryScreenRecord[];
  onCorrect: () => void;
  onClose?: () => void;
  onDelete: () => void | Promise<void>;
  deleting: boolean;
  readingLayout?: boolean;
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

/** Keeps lineage deletion explicit; text identities disambiguate native window ownership without grouping AX content. */
export default function ManualHistoryEntryDetails({
  entry,
  history,
  onCorrect,
  onClose,
  onDelete,
  deleting,
  readingLayout = false,
}: ManualHistoryEntryDetailsProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <View
      style={readingLayout ? styles.reading : styles.container}
      testID="manual-history-detail"
    >
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {t('manualHistory.form.detailsLabel')}
      </Text>
      {readingLayout ? (
        <Text style={styles.readingBody}>{entry.details}</Text>
      ) : null}
      <Text
        style={readingLayout && styles.readingMetadata}
        testID="manual-history-date-detail"
      >
        {effectiveDateLabel(entry.effectiveDate)}
      </Text>
      {!readingLayout ? <Text>{entry.details}</Text> : null}
      {history.length <= 1 ? (
        <Text
          style={readingLayout && styles.readingMetadata}
          testID="manual-history-current-status"
        >
          {t('manualHistory.status', { review: reviewLabel(entry) })}
        </Text>
      ) : null}
      {history.length > 1 ? (
        <View style={styles.history} testID="manual-history-correction-history">
          <Text style={styles.sectionTitle}>
            {t('manualHistory.detail.correctionHistory')}
          </Text>
          {history.map((version, index) => (
            <View
              key={version.id}
              style={readingLayout ? styles.readingVersion : styles.version}
              testID={'manual-history-version-' + version.id}
            >
              <Text>
                {index === history.length - 1
                  ? t('manualHistory.detail.currentVersion')
                  : t('manualHistory.detail.earlierVersion')}
              </Text>
              <Text>
                {t(
                  ('manualHistory.kind.' +
                    version.kind) as `manualHistory.kind.${ManualHistoryScreenRecord['kind']}`,
                )}
              </Text>
              <Text testID={'manual-history-status-version-' + version.id}>
                {t('manualHistory.status', { review: reviewLabel(version) })}
              </Text>
              <Text testID="manual-history-recorded-at">
                {recordedAtLabel(version.recordedAt)}
              </Text>
              <Text
                style={styles.entryTitle}
                testID={'manual-history-title-version-' + version.id}
              >
                {version.title}
              </Text>
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
      <View
        style={readingLayout ? styles.readingActions : styles.standardActions}
        testID={readingLayout ? 'history-memory-actions' : undefined}
      >
        <Button
          variant={readingLayout ? 'text' : 'secondary'}
          size={readingLayout ? 'compact' : undefined}
          disabled={deleting}
          onPress={onCorrect}
          testID="manual-history-correct"
          title={t('manualHistory.detail.correct')}
        />
        {!confirmDelete ? (
          <Button
            variant={readingLayout ? 'destructive' : 'secondary'}
            size={readingLayout ? 'compact' : undefined}
            disabled={deleting}
            onPress={() => setConfirmDelete(true)}
            testID="manual-history-delete"
            title={t('manualHistory.detail.delete')}
          />
        ) : (
          <View
            style={[
              styles.confirmation,
              readingLayout && styles.readingConfirmation,
            ]}
            testID="manual-history-delete-confirmation"
          >
            <Text>{t('manualHistory.detail.confirmDelete')}</Text>
            <Button
              variant={readingLayout ? 'destructive' : 'secondary'}
              size={readingLayout ? 'compact' : undefined}
              disabled={deleting}
              onPress={onDelete}
              testID="manual-history-confirm-delete"
              title={t('manualHistory.detail.confirmDeleteAction')}
            />
            <Button
              variant={readingLayout ? 'text' : 'secondary'}
              size={readingLayout ? 'compact' : undefined}
              disabled={deleting}
              onPress={() => setConfirmDelete(false)}
              testID="manual-history-cancel-delete"
              title={t('manualHistory.detail.cancelDelete')}
            />
          </View>
        )}
        {onClose ? (
          <Button
            variant={readingLayout ? 'text' : 'secondary'}
            size={readingLayout ? 'compact' : undefined}
            disabled={deleting}
            onPress={onClose}
            testID="manual-history-close-details"
            title={t('manualHistory.detail.close')}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: appColors.surface,
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 16,
    paddingTop: 16,
  },
  reading: { gap: 12, minWidth: 0 },
  readingBody: { color: appColors.text, fontSize: 18, lineHeight: 29 },
  readingMetadata: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  readingVersion: { gap: 6, paddingVertical: 6 },
  standardActions: { gap: 16 },
  readingActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  readingConfirmation: { flexBasis: '100%' },
  sectionTitle: { color: appColors.text, fontSize: 18, fontWeight: '600' },
  entryTitle: { color: appColors.text, fontSize: 18, fontWeight: '600' },
  history: { gap: 8, paddingTop: 8 },
  version: {
    borderLeftColor: appColors.border,
    borderLeftWidth: 2,
    gap: 6,
    paddingLeft: 10,
  },
  confirmation: {
    backgroundColor: appColors.warningSurface,
    borderRadius: 8,
    gap: 8,
    padding: 12,
  },
});
