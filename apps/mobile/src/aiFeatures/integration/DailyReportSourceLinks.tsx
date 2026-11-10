import { useEffect, useRef, useState } from 'react';
import type { DailyReportIdentity } from '@orot/domain';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import type { AiFeatureServices } from './featureServices';

/** Resolve every link through the active report revision before opening a source. */
export function DailyReportSourceLinks({
  identity,
  runId,
  revision,
  resolve,
  onOpen,
  onStale,
}: {
  identity: DailyReportIdentity;
  runId: string;
  revision: number;
  resolve?: AiFeatureServices['dailyReportSources'];
  onOpen: (source: EvidenceReference) => void;
  onStale: () => void;
}) {
  const [sources, setSources] = useState<readonly EvidenceReference[] | null>(
    null,
  );
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setSources(null);
    setError(false);
    setBusy(false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [identity, runId, revision]);
  const load = async (selected?: number) => {
    if (!resolve || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(false);
    try {
      const result = await resolve(
        identity,
        runId,
        revision,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        const current =
          result.status === 'current' && selected !== undefined
            ? result.sources[selected]
            : undefined;
        if (result.status === 'stale') {
          setSources(null);
          onStale();
        } else if (
          result.status !== 'current' ||
          (selected !== undefined && !current)
        ) {
          setSources(null);
          setError(true);
        } else if (current) onOpen(current);
        else setSources(result.sources);
      }
    } catch {
      if (!controller.signal.aborted) {
        setSources(null);
        setError(true);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <>
      <AppButton
        title={t('dailyReport.sources')}
        variant="secondary"
        busy={busy}
        disabled={!resolve}
        onPress={() => {
          load().catch(() => undefined);
        }}
      />
      {error ? (
        <AppText accessibilityRole="alert">
          {t('dailyReport.sourceError')}
        </AppText>
      ) : null}
      {sources?.map((_source, index) => (
        <AppButton
          key={index}
          title={t('dailyReport.sourceLink', { number: index + 1 })}
          variant="text"
          disabled={busy}
          onPress={() => {
            load(index).catch(() => undefined);
          }}
        />
      ))}
    </>
  );
}
