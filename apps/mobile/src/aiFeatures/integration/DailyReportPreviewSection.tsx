import { StyleSheet, View } from 'react-native';
import { AppText } from '../../layout/AppText';
import { formatDateTime, formatNumber, t } from '../../i18n';
import { DailyReportCoverage } from './DailyReportCoverage';
import type { useDailyReportRoute } from './useDailyReportRoute';

/** Presents the source coverage for the selected day before generation. */
export function DailyReportPreview({
  preview,
}: {
  preview: ReturnType<typeof useDailyReportRoute>['preview'];
}) {
  return (
    <>
      {preview?.status === 'ready' ? (
        <View style={styles.group}>
          <AppText>
            {t('dailyReport.preview', {
              time: formatDateTime(new Date(preview.cutoff), preview.timeZone),
              count: formatNumber(preview.count),
            })}
          </AppText>
          {preview.latestSourceTime ? (
            <AppText>
              {t('dailyReport.latest', {
                time: formatDateTime(
                  new Date(preview.latestSourceTime),
                  preview.timeZone,
                ),
              })}
            </AppText>
          ) : null}
          {preview.partial ? (
            <AppText>{t('dailyReport.partial')}</AppText>
          ) : null}
          <DailyReportCoverage
            coverage={preview.coverage}
            sourceCounts={preview.sourceCounts}
            timeZone={preview.timeZone}
          />
          {!preview.count ? <AppText>{t('dailyReport.empty')}</AppText> : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({ group: { gap: 8 } });
