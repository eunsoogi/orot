import { useLayoutEffect, useRef, useState } from 'react';
import type { DailyReportIdentity } from '@orot/domain';
import type { createDailyReportFeature } from './dailyReportFeature';
import type { DailyReportRecoveryTarget } from './dailyReportRecoveryActions';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';

/** Pending metadata is not prose or permission. Only a button press resumes a local
 * save. Route changes request cancellation; an already committed report is not
 * rolled back or described as unsaved. Mounting never starts a provider. */
export function DailyReportLocalRecovery({
  feature,
  identity,
  busy,
  revision,
  onBusy,
  onSaved,
}: {
  feature: ReturnType<typeof createDailyReportFeature>;
  identity: DailyReportIdentity | null;
  busy: boolean;
  revision: unknown;
  onBusy(value: boolean): void;
  onSaved(runId: string): void;
}) {
  const [targets, setTargets] = useState<DailyReportRecoveryTarget[]>([]);
  const [status, setStatus] = useState<
    'working' | 'unavailable' | 'retryable' | null
  >(null);
  const active = useRef<AbortController | null>(null);
  const callbacks = useRef({ onBusy, onSaved });
  callbacks.current = { onBusy, onSaved };
  useLayoutEffect(() => {
    active.current?.abort();
    active.current = null;
    setTargets([]);
    setStatus(null);
    callbacks.current.onBusy(false);
    if (!identity || busy || !feature.pendingRecovery) return;
    const controller = new AbortController();
    feature.pendingRecovery(identity, controller.signal).then(
      rows => {
        if (!controller.signal.aborted) setTargets(rows);
      },
      () => {
        if (!controller.signal.aborted) setStatus('unavailable');
      },
    );
    return () => {
      controller.abort();
      active.current?.abort();
      active.current = null;
    };
  }, [feature, identity, busy, revision]);
  const resume = async (target: DailyReportRecoveryTarget) => {
    if (!identity || busy || active.current || !feature.resumeRecovery) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus('working');
    callbacks.current.onBusy(true);
    try {
      const result = await feature.resumeRecovery(
        identity,
        target,
        controller.signal,
      );
      if (controller.signal.aborted || active.current !== controller) return;
      if (result.status === 'saved' || result.status === 'reused') {
        setTargets([]);
        setStatus(null);
        callbacks.current.onSaved(target.runId);
      } else {
        setStatus(result.status === 'retryable' ? 'retryable' : 'unavailable');
        if (result.status !== 'retryable') setTargets([]);
      }
    } catch {
      if (!controller.signal.aborted) setStatus('unavailable');
    } finally {
      if (active.current === controller) {
        active.current = null;
        callbacks.current.onBusy(false);
      }
    }
  };
  return (
    <>
      {targets.length ? (
        <AppText>{t('dailyReport.recovery.pending')}</AppText>
      ) : null}
      {status === 'working' ? (
        <>
          <AppText>{t('dailyReport.recovery.loading')}</AppText>
          <AppButton
            title={t('dailyReport.recovery.cancel')}
            onPress={() => {
              active.current?.abort();
              active.current = null;
              callbacks.current.onBusy(false);
              setTargets([]);
              setStatus(null);
            }}
          />
        </>
      ) : (
        targets.map(target => (
          <ReactRecoveryChoice
            key={target.runId}
            target={target}
            resume={resume}
          />
        ))
      )}
      {status === 'unavailable' || status === 'retryable' ? (
        <AppText accessibilityRole="alert">
          {t(
            status === 'retryable'
              ? 'dailyReport.recovery.retryable'
              : 'dailyReport.recovery.unavailable',
          )}
        </AppText>
      ) : null}
    </>
  );
}
function ReactRecoveryChoice({
  target,
  resume,
}: {
  target: DailyReportRecoveryTarget;
  resume(target: DailyReportRecoveryTarget): Promise<void>;
}) {
  return (
    <>
      <AppText>
        {t('dailyReport.recovery.cutoff', { time: target.request.requestedAt })}
      </AppText>
      <AppButton
        title={t('dailyReport.recovery.resume', {
          date: target.request.localDate,
        })}
        onPress={() => {
          resume(target).catch(() => {});
        }}
      />
    </>
  );
}
