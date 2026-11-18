import type { DailyReportIdentity } from '@orot/domain';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import { dailyReportRouteStyles as styles } from './dailyReportRouteStyles';
export function DailyReportHeading({
  identity,
}: {
  identity: DailyReportIdentity | null;
}) {
  return (
    <>
      <AppText accessibilityRole="header" style={styles.heading}>
        {t('dailyReport.title')}
      </AppText>
      {identity ? (
        <AppText testID="daily-report-date">
          {t('dailyReport.date', {
            date: identity.localDate,
            zone: identity.timeZone,
          })}
        </AppText>
      ) : null}
    </>
  );
}
