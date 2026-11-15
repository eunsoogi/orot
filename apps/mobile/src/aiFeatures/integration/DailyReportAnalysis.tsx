import { Fragment } from 'react';
import type { DailyReportOutput } from '@orot/domain';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';

/** Render stored prose in its exact order. Older unsectioned reports are not
 * retrospectively classified, rewritten or given a new clinical priority. */
export function DailyReportAnalysis({
  claims,
}: {
  claims: DailyReportOutput['supportedContext'];
}) {
  if (!claims.length) return null;
  return (
    <>
      <AppText accessibilityRole="header">
        {t('dailyReport.supportedContext')}
      </AppText>
      {claims.some(item => item.section) ? (
        <AppText>{t('dailyReport.analysis.scope')}</AppText>
      ) : null}
      {claims.map((item, index) => (
        <Fragment key={index}>
          {item.section && item.section !== claims[index - 1]?.section ? (
            <AppText accessibilityRole="header">
              {t(`dailyReport.analysis.${item.section}`)}
            </AppText>
          ) : null}
          {item.section === 'model' &&
          claims[index - 1]?.section !== 'model' ? (
            <AppText>{t('dailyReport.analysis.modelCaution')}</AppText>
          ) : null}
          <AppText>{item.text}</AppText>
        </Fragment>
      ))}
    </>
  );
}
