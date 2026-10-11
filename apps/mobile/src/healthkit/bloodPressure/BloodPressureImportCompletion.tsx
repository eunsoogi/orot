import { StyleSheet, View } from 'react-native';
import { t } from '../../i18n';
import { AppButton } from '../../layout/AppButton';
import { appColors } from '../../layout/appColors';
import { AppSymbol } from '../../layout/AppSymbol';
import { AppText } from '../../layout/AppText';

export type BloodPressureImportOutcome =
  'complete' | 'empty' | 'unavailable' | 'partial' | 'failed';

export interface BloodPressureImportSummary {
  readonly saved: number;
  readonly deleted: number;
}

interface BloodPressureImportCompletionProps {
  readonly status: BloodPressureImportOutcome;
  readonly summary: BloodPressureImportSummary | null;
  readonly onOpenLibrary: () => void;
  readonly onRetry: () => void;
}

/** Shows an import outcome without exposing the imported measurements in place. */
export function BloodPressureImportCompletion({
  status,
  summary,
  onOpenLibrary,
  onRetry,
}: BloodPressureImportCompletionProps) {
  const copy = outcomeCopy(status);
  const isProblem = status === 'failed' || status === 'unavailable';

  return (
    <View style={styles.container} testID="blood-pressure-import-completion">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.outcomeIcon, isProblem && styles.problemIcon]}
      >
        <AppSymbol
          color={isProblem ? appColors.danger : appColors.primary}
          name={isProblem ? 'exclamationmark' : 'checkmark'}
          size={34}
        />
      </View>
      <AppText
        accessibilityLiveRegion="polite"
        accessibilityRole={isProblem ? 'alert' : 'header'}
        style={[styles.title, isProblem && styles.problemText]}
        testID="blood-pressure-status"
      >
        {copy.title}
      </AppText>
      <AppText style={styles.description}>{copy.description}</AppText>
      {status === 'empty' || status === 'unavailable' ? (
        <AppText
          style={styles.authorizationNote}
          testID="blood-pressure-read-authorization"
        >
          {t('healthkit.bloodPressure.readAuthorization')}
        </AppText>
      ) : null}

      {summary ? (
        <View style={styles.summaryCard} testID="blood-pressure-result-summary">
          <SummaryRow
            icon="doc.text"
            label={t('healthkit.bloodPressure.summary.saved')}
            testID="blood-pressure-result-saved-count"
            value={summary.saved}
          />
          <View style={styles.separator} />
          <SummaryRow
            icon="trash"
            label={t('healthkit.bloodPressure.summary.deleted')}
            testID="blood-pressure-result-deleted-count"
            value={summary.deleted}
          />
        </View>
      ) : null}

      <View style={styles.privacyNote}>
        <AppSymbol name="lock.fill" size={16} />
        <AppText style={styles.privacyText}>
          {t('healthkit.bloodPressure.localOnly')}
        </AppText>
      </View>

      <AppButton
        onPress={onOpenLibrary}
        testID="blood-pressure-open-library"
        title={t('healthkit.bloodPressure.openLibrary')}
      />
      <AppButton
        onPress={onRetry}
        testID="blood-pressure-import-again"
        title={t('healthkit.bloodPressure.importAgain')}
        variant="secondary"
      />
    </View>
  );
}

function SummaryRow({
  icon,
  label,
  testID,
  value,
}: {
  readonly icon: string;
  readonly label: string;
  readonly testID: string;
  readonly value: number;
}) {
  return (
    <View style={styles.summaryRow}>
      <AppSymbol name={icon} size={22} />
      <AppText style={styles.summaryLabel}>{label}</AppText>
      <AppText style={styles.summaryCount} testID={testID}>
        {t('healthkit.bloodPressure.summary.count', { count: value })}
      </AppText>
    </View>
  );
}

function outcomeCopy(status: BloodPressureImportOutcome) {
  switch (status) {
    case 'complete':
      return {
        title: t('healthkit.bloodPressure.outcome.complete.title'),
        description: t('healthkit.bloodPressure.outcome.complete.description'),
      };
    case 'empty':
      return {
        title: t('healthkit.bloodPressure.outcome.empty.title'),
        description: t('healthkit.bloodPressure.outcome.empty.description'),
      };
    case 'partial':
      return {
        title: t('healthkit.bloodPressure.outcome.partial.title'),
        description: t('healthkit.bloodPressure.outcome.partial.description'),
      };
    case 'unavailable':
      return {
        title: t('healthkit.bloodPressure.outcome.unavailable.title'),
        description: t(
          'healthkit.bloodPressure.outcome.unavailable.description',
        ),
      };
    case 'failed':
      return {
        title: t('healthkit.bloodPressure.outcome.failed.title'),
        description: t('healthkit.bloodPressure.outcome.failed.description'),
      };
  }
}

const styles = StyleSheet.create({
  container: { gap: 18, paddingTop: 20 },
  outcomeIcon: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 38,
    height: 76,
    justifyContent: 'center',
    width: 76,
  },
  problemIcon: { backgroundColor: appColors.dangerSurface },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  problemText: { color: appColors.danger },
  description: {
    color: appColors.secondary,
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
  },
  authorizationNote: { color: appColors.secondary, fontSize: 14 },
  summaryCard: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
  },
  summaryRow: { alignItems: 'center', flexDirection: 'row', minHeight: 64 },
  summaryLabel: { flex: 1, fontSize: 16, marginLeft: 12 },
  summaryCount: {
    color: appColors.primaryText,
    fontSize: 18,
    fontWeight: '700',
  },
  separator: {
    backgroundColor: appColors.border,
    height: StyleSheet.hairlineWidth,
  },
  privacyNote: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 4,
  },
  privacyText: { color: appColors.secondary, flexShrink: 1, fontSize: 14 },
});
