import type { DailyReportIdentity } from '@orot/domain';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import type { useDailyReportRoute } from './useDailyReportRoute';

/** Retry a saved result's reference, or explicitly adopt a verified replacement. */
export function DailyReportResultRecovery({
  state,
  identity,
  revisionChanged,
  enabled,
}: {
  state: ReturnType<typeof useDailyReportRoute>;
  identity: DailyReportIdentity | null;
  revisionChanged: boolean;
  enabled: boolean;
}) {
  if (state.resultSaveFailed)
    return (
      <>
        <AppText accessibilityRole="alert">
          {t('dailyReport.lookupError')}
        </AppText>
        <AppButton
          title={t('dailyReport.retry')}
          variant="secondary"
          onPress={state.retryResult}
        />
      </>
    );
  const lookup = state.lookup;
  if (!revisionChanged || lookup?.status !== 'saved' || !identity || !enabled)
    return null;
  return (
    <AppButton
      title={t('dailyReport.useLatestSaved')}
      variant="secondary"
      disabled={state.busy}
      onPress={() => state.retainResult(identity, lookup.runId)}
    />
  );
}
