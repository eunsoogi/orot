import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { createDailyReportIdentity } from '@orot/domain';
import type { DailyReportIdentity } from '@orot/domain';
import { currentDailyReportContextRequest } from '../../healthEvidence/healthContext/dailyReportWindow';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';
import { useAiFeatureScreenNavigationState } from './useAiFeatureNavigationState';
import type { AiFeatureNavigationStateChange } from './useAiFeatureNavigationState';
import type { createDailyReportFeature } from './dailyReportFeature';
import { useDailyReportRoute } from './useDailyReportRoute';
import { DailyReportCoverage } from './DailyReportCoverage';
import { DailyReportSourceLinks } from './DailyReportSourceLinks';
import type { AiFeatureServices } from './featureServices';
import type { EvidenceReference } from '@orot/agent-runtime';

/** Displays an exact saved day; only the explicit action may invoke generation. */
function todayIdentity() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const request = currentDailyReportContextRequest(
    new Date().toISOString(),
    zone,
  );
  return request.status === 'ready'
    ? createDailyReportIdentity(
        request.request.localDate,
        request.request.timeZone,
      )
    : null;
}

export function DailyReportRoute({
  feature,
  initialIdentity,
  initialOperation,
  reminder,
  providerSelection,
  onBack,
  onChat,
  resolveSources,
  onOpenSource,
  navigationRouteKey,
  onNavigationStateChange,
  ownsOperation = true,
}: {
  readonly feature: ReturnType<typeof createDailyReportFeature>;
  readonly initialIdentity?: DailyReportIdentity;
  readonly initialOperation?: ReturnType<
    ReturnType<typeof createDailyReportFeature>['start']
  >;
  readonly reminder?: boolean;
  readonly providerSelection: ReactNode;
  readonly onBack: () => void;
  readonly onChat: () => void;
  readonly resolveSources?: AiFeatureServices['dailyReportSources'];
  readonly onOpenSource?: (source: EvidenceReference) => void;
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly ownsOperation?: boolean;
}) {
  const navigationInset = useNavigationContentInset();
  const today = todayIdentity();
  const [identity, setIdentity] = useState(initialIdentity ?? today);
  const [chosenToday, setChosenToday] = useState(
    !initialIdentity || initialIdentity.key === today?.key,
  );
  const state = useDailyReportRoute(
    feature,
    identity,
    identity?.key === initialIdentity?.key ? initialOperation : undefined,
    ownsOperation,
  );
  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges: false,
      isRecording: false,
      hasOngoingOperation: state.busy,
    },
    0,
    onNavigationStateChange,
  );
  useEffect(() => {
    const current = todayIdentity();
    setIdentity(initialIdentity ?? current);
    setChosenToday(!initialIdentity || initialIdentity.key === current?.key);
  }, [initialIdentity]);
  const isToday = identity?.key === today?.key;
  const canGenerate = Boolean(
    isToday && chosenToday && state.lookup && state.lookup.status !== 'error',
  );
  const saved = state.lookup?.status === 'saved' ? state.lookup : null;
  return (
    <ScrollView
      contentContainerStyle={[styles.content, navigationInset]}
      testID="daily-report-screen"
    >
      {!navigationRouteKey ? (
        <AppButton
          title={t('dailyReport.back')}
          accessibilityLabel={t('dailyReport.backAccessibility')}
          variant="text"
          onPress={onBack}
        />
      ) : null}
      <AppText accessibilityRole="header" style={styles.heading}>
        {t('dailyReport.title')}
      </AppText>
      {identity ? (
        <AppText>
          {t('dailyReport.date', {
            date: identity.localDate,
            zone: identity.timeZone,
          })}
        </AppText>
      ) : null}
      {reminder && !chosenToday ? (
        <AppText>{t('dailyReport.reminderZone')}</AppText>
      ) : null}
      {providerSelection}
      <AppText>{t('dailyReport.consent')}</AppText>
      {state.loading ? <AppText>{t('dailyReport.preparing')}</AppText> : null}
      {state.preview?.status === 'ready' ? (
        <View style={styles.group}>
          <AppText>
            {t('dailyReport.preview', {
              time: state.preview.cutoff,
              count: state.preview.count,
            })}
          </AppText>
          {state.preview.latestSourceTime ? (
            <AppText>
              {t('dailyReport.latest', {
                time: state.preview.latestSourceTime,
              })}
            </AppText>
          ) : null}
          {state.preview.partial ? (
            <AppText>{t('dailyReport.partial')}</AppText>
          ) : null}
          <DailyReportCoverage coverage={state.preview.coverage} />
          {!state.preview.count ? (
            <AppText>{t('dailyReport.empty')}</AppText>
          ) : null}
        </View>
      ) : null}
      {saved ? (
        <View style={styles.group}>
          <AppText>
            {t('dailyReport.generatedAt', { time: saved.report.generatedAt })}
          </AppText>
          <AppText>
            {t('dailyReport.reportCutoff', {
              time: saved.context.generationCutoff,
            })}
          </AppText>
          <AppText accessibilityRole="header">
            {t('dailyReport.observations')}
          </AppText>
          {saved.report.observations.map((item, index) => (
            <AppText key={index}>{item.text}</AppText>
          ))}
          <DailyReportCoverage coverage={saved.report.coverage} />
          {onOpenSource ? (
            <DailyReportSourceLinks
              identity={saved.context.identity}
              runId={saved.runId}
              revision={saved.revision}
              resolve={resolveSources}
              onOpen={onOpenSource}
              onStale={state.refresh}
            />
          ) : null}
          <AppText>{t('dailyReport.reportCaution')}</AppText>
          <AppText>{t('dailyReport.chatNote')}</AppText>
          <AppButton
            title={t('dailyReport.chat')}
            variant="secondary"
            onPress={onChat}
          />
        </View>
      ) : null}
      {state.lookup?.status === 'stale' ? (
        <AppText>{t('dailyReport.stale')}</AppText>
      ) : null}
      {!isToday && state.lookup && state.lookup.status !== 'saved' ? (
        <AppText>{t('dailyReport.missingOld')}</AppText>
      ) : null}
      {state.lookup?.status === 'error' || state.preview?.status === 'error' ? (
        <>
          <AppText accessibilityRole="alert">
            {t('dailyReport.lookupError')}
          </AppText>
          <AppButton
            title={t('dailyReport.retry')}
            variant="secondary"
            onPress={state.refresh}
          />
        </>
      ) : null}
      {!chosenToday || !isToday ? (
        <AppButton
          title={t('dailyReport.selectToday')}
          onPress={() => {
            setIdentity(todayIdentity());
            setChosenToday(true);
          }}
        />
      ) : null}
      {state.busy ? (
        <>
          <AppText>{t('dailyReport.loading')}</AppText>
          <AppButton
            title={t('dailyReport.cancel')}
            variant="secondary"
            onPress={state.cancel}
          />
        </>
      ) : null}
      {state.failure ? (
        <AppText accessibilityRole="alert">
          {t(
            state.failure === 'cancelled'
              ? 'dailyReport.cancelled'
              : 'dailyReport.failure',
          )}
        </AppText>
      ) : null}
      {canGenerate && !state.busy ? (
        <AppButton
          title={t(
            saved || state.lookup?.status === 'stale'
              ? 'dailyReport.regenerate'
              : 'dailyReport.generate',
          )}
          onPress={state.generate}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  heading: { fontSize: 26, fontWeight: '700' },
  group: { gap: 8 },
});
