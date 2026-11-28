import { possibilityReportTemplate } from '../ragConversation/conversationReportTemplate';
import { GeneratedVisitQuestionPreview } from './GeneratedVisitQuestionPreview';
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
import type { HistoricalBookmarkedHealthSummary } from '../storage/bookmarkedHistoricalHealthSummary';
import { savedHistoricalReadAdmission } from '../generatedReports/savedReportNativeProtection';
import { generatedReportCopy } from '../generatedReports/text';
import { openSavedGeneratedReportReferences } from './openSavedGeneratedReportReferences';

/** Resolve the original only on explicit local open; never treat it as authored memory. */
export function SavedGeneratedReportDetail({
  artifactId,
  reportKind,
  isReadCurrent,
}: {
  artifactId: string;
  reportKind?:
    | 'health_summary'
    | 'health_summary_section'
    | 'disease_possibilities'
    | 'conversation_disease_possibilities'
    | 'visit_questions';
  isReadCurrent: () => boolean;
}) {
  const [result, setResult] = useState<
    | string
    | {
        readonly bookmarkedVisitQuestions: readonly {
          id: string;
          questionText: string;
          rationale: string;
        }[];
      }
    | HealthSummaryResult
    | HistoricalBookmarkedHealthSummary
    | GeneratedReportDetail
    | null
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const admission = savedHistoricalReadAdmission(controller.signal, () => {
      if (mounted && isReadCurrent()) setResult(null);
      controller.abort();
    });
    // The parent invalidates this exact generation inside the existing
    // AppState/deletion callbacks, before a render or unmount can commit.
    const isCurrent = () =>
      mounted && !controller.signal.aborted && isReadCurrent();
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
      if (reportKind === 'conversation_disease_possibilities') {
        const exact = await storage.readBookmarkedConversationPossibility(
          artifactId,
          {
            current: isCurrent,
            confirmProtected: admission.confirm,
          },
        );
        const template = exact && possibilityReportTemplate();
        return exact && template && isCurrent()
          ? {
              paragraphs: [],
              conversationPossibility: {
                title: template.title,
                sections: template.sections.map((title, index) => ({
                  title,
                  content:
                    exact.sections[index]! +
                    (index === template.sections.length - 1
                      ? exact.trailing
                      : ''),
                })),
              },
            }
          : null;
      }
      if (reportKind === 'visit_questions') {
        if (!(await admission.confirm()) || !isCurrent()) return null;
        const questions = await storage.readSavedVisitQuestionReference(
          artifactId,
          isCurrent,
        );
        return questions &&
          isCurrent() &&
          (await admission.confirm()) &&
          isCurrent()
          ? { bookmarkedVisitQuestions: questions }
          : null;
      }
      if (reportKind === 'health_summary_section') {
        const section = await storage.readBookmarkedHealthSummarySection(
          artifactId,
          { current: isCurrent, confirmProtected: admission.confirm },
        );
        return section && isCurrent() ? section.detail : null;
      }
      if (reportKind === 'health_summary') {
        const strict = await storage.readSavedHealthSummaryReference(
          artifactId,
          isCurrent,
        );
        return (
          strict ??
          storage.readBookmarkedHistoricalHealthSummary(
            artifactId,
            isCurrent,
            admission.confirm,
          )
        );
      }
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
      controller.abort();
      admission.dispose();
    };
  }, [artifactId, reportKind, isReadCurrent]);
  if (!isReadCurrent()) return null;
  return (
    <View testID="saved-generated-report-detail">
      <AppText accessibilityRole="header">
        {t(
          reportKind === 'health_summary_section'
            ? 'savedMemory.generatedReportHealthSummarySection'
            : reportKind === 'health_summary'
              ? 'savedMemory.generatedReportHealthSummary'
              : reportKind === 'disease_possibilities' ||
                  reportKind === 'conversation_disease_possibilities'
                ? 'savedMemory.generatedReportDiseasePossibilities'
                : reportKind === 'visit_questions'
                  ? 'savedMemory.generatedReportVisitQuestions'
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
      ) : 'bookmarkedVisitQuestions' in result ? (
        <GeneratedVisitQuestionPreview
          questions={result.bookmarkedVisitQuestions}
        />
      ) : 'paragraphs' in result ? (
        <GeneratedReportContent detail={result} />
      ) : (
        <>
          {'historicalSnapshot' in result && (
            <AppText>{generatedReportCopy.historicalHealthSummary}</AppText>
          )}
          <HealthSummaryCard
            result={result}
            showCitations={false}
            onOpenSource={() => {}}
            onLinkError={() => {}}
          />
        </>
      )}
    </View>
  );
}
