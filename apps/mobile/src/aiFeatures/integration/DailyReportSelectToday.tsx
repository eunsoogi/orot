import { useEffect, useRef, useState } from 'react';
import { createDailyReportIdentity } from '@orot/domain';
import type {
  DailyReportContextRequest,
  DailyReportIdentity,
} from '@orot/domain';
import { currentDailyReportContextRequest } from '../../healthEvidence/healthContext/dailyReportWindow';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';

/** Commit the route-owned date before exposing generation, including after a restart. */
export function DailyReportSelectToday({
  persist,
  onSelected,
}: {
  persist?: (request: DailyReportContextRequest) => Promise<void>;
  onSelected: (identity: DailyReportIdentity) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const select = async () => {
    if (pending.current) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const current = currentDailyReportContextRequest(
      new Date().toISOString(),
      zone,
    );
    if (current.status !== 'ready') {
      setFailed(true);
      return;
    }
    pending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await persist?.(current.request);
      if (mounted.current)
        onSelected(
          createDailyReportIdentity(
            current.request.localDate,
            current.request.timeZone,
          ),
        );
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      {failed ? (
        <AppText accessibilityRole="alert">
          {t('dailyReport.selectionError')}
        </AppText>
      ) : null}
      <AppButton
        title={t('dailyReport.selectToday')}
        busy={busy}
        onPress={select}
      />
    </>
  );
}
