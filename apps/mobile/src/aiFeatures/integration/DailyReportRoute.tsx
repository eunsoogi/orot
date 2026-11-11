import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { todayIdentity } from './dailyReportTodayIdentity';
import type { DailyReportRouteProps } from './DailyReportRouteProps';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';
import { useAiFeatureScreenNavigationState } from './useAiFeatureNavigationState';
import { useDailyReportRoute } from './useDailyReportRoute';
import { dailyReportFailureMessage } from './dailyReportFailurePresentation';
import { DailyReportPreview } from './DailyReportPreviewSection';
import { useRetainExistingReport } from './useRetainExistingReport';
import { dailyReportLookupNotice } from './dailyReportLookupNotice';
import { DailyReportSavedSection } from './DailyReportSavedSection';
import { DailyReportResultRecovery } from './DailyReportResultRecovery';
import { DailyReportSelectToday } from './DailyReportSelectToday';
import { useReportTaskPersistence } from './useReportTaskPersistence';

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
  inline = false,
  expectedReport,
  onTaskIdentity,
  onTaskResult,
  taskRevision,
}: DailyReportRouteProps) {
  const navigationInset = useNavigationContentInset();
  const initialDate = initialIdentity?.localDate;
  const initialZone = initialIdentity?.timeZone;
  const today = todayIdentity();
  const [identity, setIdentity] = useState(initialIdentity ?? today);
  const taskPersistence = useReportTaskPersistence(identity, onTaskIdentity);
  const [chosenToday, setChosenToday] = useState(
    !initialIdentity || initialIdentity.key === today?.key,
  );
  const state = useDailyReportRoute(
    feature,
    identity,
    identity?.key === initialIdentity?.key ? initialOperation : undefined,
    ownsOperation,
    onTaskResult,
  );
  const resultPersistence = useRetainExistingReport(
    state.lookup,
    expectedReport,
    taskRevision,
    onTaskResult,
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
    state.failure !== 'report_read_failed' &&
    taskPersistence.status === 'ready' &&
    resultPersistence.status === 'ready' &&
    !state.resultSaveFailed,
  );
  // A restored conversation points to one exact revision; a replacement is not that result.
  const revisionChanged = Boolean(
    expectedReport &&
    state.lookup?.status === 'saved' &&
    (state.lookup.runId !== expectedReport.runId ||
      state.lookup.revision !== expectedReport.revision),
  );
  const saved =
    state.lookup?.status === 'saved' && !revisionChanged ? state.lookup : null;
  const lookup = state.lookup;
  // An invalidated or unreadable report has a known state distinct from a missing day.
  const lookupNotice = dailyReportLookupNotice(
    lookup,
    revisionChanged,
    isToday,
  );
  const content = (
    <>
      {!navigationRouteKey && !inline ? (
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
      {taskPersistence.status === 'failed' ||
      resultPersistence.status === 'failed' ? (
        <>
          <AppText accessibilityRole="alert">
            {t('dailyReport.lookupError')}
          </AppText>
          <AppButton
            title={t('dailyReport.retry')}
            variant="secondary"
            onPress={
              taskPersistence.status === 'failed'
                ? taskPersistence.retry
                : resultPersistence.retry
            }
          />
        </>
      ) : null}
      <DailyReportPreview preview={state.preview} />
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
      <DailyReportResultRecovery
        state={state}
        identity={identity}
        revisionChanged={revisionChanged}
        enabled={Boolean(onTaskResult)}
      />
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
            saved || revisionChanged || state.lookup?.status === 'stale'
              ? 'dailyReport.regenerate'
              : 'dailyReport.generate',
          )}
          onPress={state.generate}
        />
      ) : null}
    </>
  );
  return inline ? (
    <View style={styles.content} testID="inline-daily-report-task">
      {content}
    </View>
  ) : (
    <ScrollView
      contentContainerStyle={[styles.content, navigationInset]}
      testID="daily-report-screen"
    >
      {content}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  heading: { fontSize: 26, fontWeight: '700' },
});
