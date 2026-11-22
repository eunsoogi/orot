import { conversationDailyReportText } from '../aiFeatures/integration/conversationDailyReportText';
import { GeneratedReportContent } from '../generatedReports/GeneratedReportContent';
import { openGeneratedReportReader } from '../generatedReports/readers';
import type { GeneratedReportDetail } from '../generatedReports/types';
import { useLayoutEffect, useState } from 'react';
import { View } from 'react-native';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { HealthSummaryCard } from '../ragConversation/HealthSummaryCard';
import type { HealthSummaryResult } from '../ragConversation/healthSummary';
import { openSavedGeneratedReportReferences } from './openSavedGeneratedReportReferences';

/** Resolve the original only on explicit local open; never treat it as authored memory. */
export function SavedGeneratedReportDetail({
  artifactId,
  reportKind,
  isReadCurrent,
}: {
  artifactId: string;
  reportKind?: 'health_summary' | 'disease_possibilities';
  isReadCurrent: () => boolean;
}) {
  const [result, setResult] = useState<
    string | HealthSummaryResult | GeneratedReportDetail | null | undefined
  >(undefined);
  useLayoutEffect(() => {
    let mounted = true;
    // The parent invalidates this exact generation inside the existing
    // AppState/deletion callbacks, before a render or unmount can commit.
    const isCurrent = () => mounted && isReadCurrent();
    if (!isCurrent()) return;
    const load = async () => {
      if (reportKind === 'disease_possibilities') {
        const reader = await openGeneratedReportReader();
        return isCurrent()
          ? reader.readBookmarkedDiseasePossibilities(artifactId, isCurrent)
          : null;
      }
      const storage = await openSavedGeneratedReportReferences();
      if (!isCurrent()) return null;
      if (reportKind === 'health_summary')
        return storage.readSavedHealthSummaryReference(artifactId, isCurrent);
      const report = await storage.readSavedGeneratedReportReference(
        artifactId,
        isCurrent,
      );
      return report ? conversationDailyReportText(report) : null;
    };
    load()
      .then(report => {
        if (isCurrent()) setResult(report);
      })
      .catch(() => {
        if (isCurrent()) setResult(null);
      });
    return () => {
      mounted = false;
    };
  }, [artifactId, reportKind, isReadCurrent]);
  if (!isReadCurrent()) return null;
  return (
    <View testID="saved-generated-report-detail">
      <AppText accessibilityRole="header">
        {t(
          reportKind === 'health_summary'
            ? 'savedMemory.generatedReportHealthSummary'
            : reportKind === 'disease_possibilities'
              ? 'savedMemory.generatedReportDiseasePossibilities'
              : 'savedMemory.generatedReportDaily',
        )}
      </AppText>
      <AppText>{t('savedMemory.generatedReportOrigin')}</AppText>
      {result === undefined ? (
        <AppText>{t('savedMemory.loading')}</AppText>
      ) : !result ? (
        <AppText accessibilityRole="alert">
          {t('savedMemory.generatedReportUnavailable')}
        </AppText>
      ) : typeof result === 'string' ? (
        <AppText selectable>{result}</AppText>
      ) : 'paragraphs' in result ? (
        <GeneratedReportContent detail={result} />
      ) : (
        <HealthSummaryCard
          result={result}
          showCitations={false}
          onOpenSource={() => {}}
          onLinkError={() => {}}
        />
      )}
    </View>
  );
}
