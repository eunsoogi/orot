import { Fragment } from 'react';
import type { DailyReportOutput } from '@orot/domain';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import { dailyReportFocusHeading } from './dailyReportFocus';

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
      {!claims[0]?.focus ? (
        <AppText accessibilityRole="header">
          {t('dailyReport.supportedContext')}
        </AppText>
      ) : null}
      {claims.map((item, index) => (
        <Fragment key={index}>
          {item.focus ? (
            item.focus !== claims[index - 1]?.focus ? (
              <AppText accessibilityRole="header">
                {dailyReportFocusHeading(item.focus)}
              </AppText>
            ) : null
          ) : item.section && item.section !== claims[index - 1]?.section ? (
            <AppText accessibilityRole="header">
              {t(`dailyReport.analysis.${item.section}`)}
            </AppText>
          ) : null}
          <AppText>{item.text}</AppText>
        </Fragment>
      ))}
    </>
  );
}
