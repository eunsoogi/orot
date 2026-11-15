import { View, StyleSheet } from 'react-native';
import { useLayoutEffect, useRef } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText } from '../../layout/AppText';
import { AppButton } from '../../layout/AppButton';
import { formatDateTime, t } from '../../i18n';
import { DailyReportCoverage } from './DailyReportCoverage';
import { dailyReportCoverageCounts } from './dailyReportCoverageCounts';
import { DailyReportSourceLinks } from './DailyReportSourceLinks';
import type { createDailyReportFeature } from './dailyReportFeature';
import type { AiFeatureServices } from './featureServices';
import type { ConversationEntryContext } from './conversationIntent';

type Feature = ReturnType<typeof createDailyReportFeature>;
type Saved = Extract<
  Awaited<ReturnType<Feature['lookup']>>,
  { status: 'saved' }
>;

/** The exact saved revision is rechecked before opening its route-local conversation identity. */
export function DailyReportSavedSection({
  saved,
  feature,
  resolveSources,
  onOpenSource,
  onChat,
  onStale,
}: {
  saved: Saved;
  feature: Feature;
  resolveSources?: AiFeatureServices['dailyReportSources'];
  onOpenSource?: (source: EvidenceReference) => void;
  onChat: (
    target: NonNullable<ConversationEntryContext['dailyReport']>,
  ) => void;
  onStale: () => void;
}) {
  const generation = useRef(0);
  useLayoutEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [saved.runId, saved.revision]);
  const { timeZone } = saved.context.identity;
  const sourceCounts = dailyReportCoverageCounts(
    saved.context.sourceSnapshot?.records,
  );
  return (
    <View style={styles.group}>
      <AppText>
        {t('dailyReport.savedRevision', { revision: saved.revision })}
      </AppText>
      <AppText>
        {t('dailyReport.generatedAt', {
          time: formatDateTime(new Date(saved.report.generatedAt), timeZone),
        })}
      </AppText>
      <AppText>
        {t('dailyReport.reportCutoff', {
          time: formatDateTime(
            new Date(saved.context.generationCutoff),
            timeZone,
          ),
        })}
      </AppText>
      {saved.report.supportedContext.length > 0 ? (
        <>
          <AppText accessibilityRole="header">
            {t('dailyReport.supportedContext')}
          </AppText>
          {saved.report.supportedContext.map((item, index) => (
            <AppText key={index}>{item.text}</AppText>
          ))}
        </>
      ) : null}
      <AppText accessibilityRole="header">
        {t('dailyReport.observations')}
      </AppText>
      {saved.report.observations.map((item, index) => (
        <AppText key={index}>{item.text}</AppText>
      ))}
      <DailyReportCoverage
        coverage={saved.report.coverage}
        sourceCounts={sourceCounts}
        timeZone={timeZone}
      />
      {onOpenSource ? (
        <DailyReportSourceLinks
          identity={saved.context.identity}
          runId={saved.runId}
          revision={saved.revision}
          resolve={resolveSources}
          onOpen={onOpenSource}
          onStale={onStale}
        />
      ) : null}
      <AppText>{t('dailyReport.reportCaution')}</AppText>
      {saved.report.followUpQuestions.length > 0 ? (
        <>
          <AppText accessibilityRole="header">
            {t('dailyReport.suggestedQuestions')}
          </AppText>
          {saved.report.followUpQuestions.map((question, index) => (
            <AppText key={index}>{question}</AppText>
          ))}
        </>
      ) : null}
      <AppText>{t('dailyReport.chatNote')}</AppText>
      <AppButton
        title={t('dailyReport.chat')}
        variant="secondary"
        onPress={() => {
          const requestGeneration = generation.current;
          feature
            .lookup(saved.context.identity)
            .then(current => {
              if (generation.current !== requestGeneration) return;
              if (
                current.status === 'saved' &&
                current.runId === saved.runId &&
                current.revision === saved.revision
              )
                onChat({
                  identity: saved.context.identity,
                  runId: saved.runId,
                  revision: saved.revision,
                });
              else onStale();
            })
            .catch(() => {
              if (generation.current === requestGeneration) onStale();
            });
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({ group: { gap: 8 } });
