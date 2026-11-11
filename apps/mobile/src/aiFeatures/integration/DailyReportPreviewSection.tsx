import { StyleSheet, View } from 'react-native';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
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
              time: preview.cutoff,
              count: preview.count,
            })}
          </AppText>
          {preview.latestSourceTime ? (
            <AppText>
              {t('dailyReport.latest', {
                time: preview.latestSourceTime,
              })}
            </AppText>
          ) : null}
          {preview.partial ? (
            <AppText>{t('dailyReport.partial')}</AppText>
          ) : null}
          <DailyReportCoverage coverage={preview.coverage} />
          {!preview.count ? <AppText>{t('dailyReport.empty')}</AppText> : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({ group: { gap: 8 } });
