import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { createDailyReportIdentity } from '@orot/domain';
import type { DailyReportIdentity } from '@orot/domain';
import type { DailyReportContextRequest } from '@orot/domain';
import { currentDailyReportContextRequest } from '../../healthEvidence/healthContext/dailyReportWindow';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';
import { useAiFeatureScreenNavigationState } from './useAiFeatureNavigationState';
import type { AiFeatureNavigationStateChange } from './useAiFeatureNavigationState';
import type { createDailyReportFeature } from './dailyReportFeature';
import { useDailyReportRoute } from './useDailyReportRoute';
import { dailyReportFailureMessage } from './dailyReportFailurePresentation';
import { DailyReportCoverage } from './DailyReportCoverage';
import { DailyReportSavedSection } from './DailyReportSavedSection';
import { DailyReportSelectToday } from './DailyReportSelectToday';
import type { AiFeatureServices } from './featureServices';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationEntryContext } from './conversationIntent';

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
  onSelectToday,
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
  readonly onSelectToday?: (
    request: DailyReportContextRequest,
  ) => Promise<void>;
  readonly onChat: (
    target: NonNullable<ConversationEntryContext['dailyReport']>,
  ) => void;
  readonly resolveSources?: AiFeatureServices['dailyReportSources'];
  readonly onOpenSource?: (source: EvidenceReference) => void;
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly ownsOperation?: boolean;
}) {
  const navigationInset = useNavigationContentInset();
  const initialDate = initialIdentity?.localDate;
  const initialZone = initialIdentity?.timeZone;
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
    const next =
      initialDate && initialZone
        ? createDailyReportIdentity(initialDate, initialZone)
        : current;
    setIdentity(previous => (previous?.key === next?.key ? previous : next));
    setChosenToday(!initialDate || next?.key === current?.key);
    // Identity keys encode the date and zone; equivalent objects must not release an active operation.
  }, [initialDate, initialZone]);
  const isToday = identity?.key === today?.key;
  const canGenerate = Boolean(
    isToday &&
    chosenToday &&
    state.lookup &&
    state.lookup.status !== 'error' &&
    state.failure !== 'report_read_failed',
  );
  const saved = state.lookup?.status === 'saved' ? state.lookup : null;
  const lookup = state.lookup;
  // An invalidated or unreadable report has a known state distinct from a missing day.
  const lookupNotice =
    lookup?.status === 'stale'
      ? 'sourceStatus' in lookup && lookup.sourceStatus === 'deleted'
        ? 'dailyReport.deletedSource'
        : 'dailyReport.stale'
      : lookup?.status === 'deleted'
        ? 'dailyReport.deleted'
        : !isToday && lookup?.status === 'missing'
          ? 'dailyReport.missingOld'
          : null;
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
        <AppText testID="daily-report-date">
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
        <DailyReportSavedSection
          saved={saved}
          feature={feature}
          resolveSources={resolveSources}
          onOpenSource={onOpenSource}
          onChat={onChat}
          onStale={state.refresh}
        />
      ) : null}
      {lookupNotice ? <AppText>{t(lookupNotice)}</AppText> : null}
      {state.lookup?.status === 'error' ||
      state.preview?.status === 'error' ||
      state.failure === 'report_read_failed' ? (
        <>
          <AppText accessibilityRole="alert">
            {t('dailyReport.lookupError')}
          </AppText>
          <AppButton
            title={t('dailyReport.retry')}
            variant="secondary"
            onPress={state.retry}
          />
        </>
      ) : null}
      {!chosenToday || !isToday ? (
        <DailyReportSelectToday
          persist={onSelectToday}
          onSelected={selected => {
            setIdentity(selected);
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
      {state.failure && state.failure !== 'report_read_failed' ? (
        <AppText accessibilityRole="alert">
          {dailyReportFailureMessage(state.failure, Boolean(saved))}
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
