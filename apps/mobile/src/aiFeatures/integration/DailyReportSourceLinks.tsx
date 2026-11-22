import {
  Fragment,
  createContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { DailyReportIdentity } from '@orot/domain';
import type { EvidenceReference } from '@orot/agent-runtime';
import {
  DailyReportCitationControl,
  DailyReportCitationStrip,
} from './DailyReportCitationControl';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';
import type { AiFeatureServices } from './featureServices';
import type { DailyReportCitationPresentation } from './dailyReportCitationPresentation';

export const DailyReportSourceResolverContext =
  createContext<AiFeatureServices['dailyReportSources']>(undefined);

/** Resolve every link through the active report revision before opening a source. */
export function DailyReportSourceLinks({
  identity,
  runId,
  revision,
  resolve,
  onOpen,
  onStale,
  testIDPrefix,
  transcript = false,
}: {
  identity: DailyReportIdentity;
  runId: string;
  revision: number;
  resolve?: AiFeatureServices['dailyReportSources'];
  onOpen: (source: EvidenceReference) => void;
  onStale: () => void;
  testIDPrefix?: string;
  transcript?: boolean;
}) {
  const [sources, setSources] = useState<DailyReportCitationPresentation>();
  const [expanded, setExpanded] = useState<number>();
  const [otherExpanded, setOtherExpanded] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    setSources(undefined);
    setError(false);
    setExpanded(undefined);
    setOtherExpanded(false);
    setBusy(false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [identity.key, runId, revision, resolve]);
  const load = async (selected?: number) => {
    if (!resolve || request.current) return;
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
        selected === undefined ? 'presentation' : undefined,
      );
      if (!controller.signal.aborted) {
        const current =
          result.status === 'current' && selected !== undefined
            ? result.sources[selected]
            : undefined;
        if (result.status === 'stale' || result.status === 'deleted') {
          setSources(undefined);
          // The route must hide saved text when its backing evidence is no longer valid.
          onStale();
        } else if (
          result.status !== 'current' ||
          (selected !== undefined && !current)
        ) {
          setSources(undefined);
          setError(true);
        } else if (current) onOpen(current);
        else {
          setExpanded(undefined);
          setOtherExpanded(false);
          setSources(
            result.presentation ?? {
              statistics: [],
              directSources: result.sources.map((_source, index) => index),
              otherSources: [],
            },
          );
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        setSources(undefined);
        setError(true);
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  const sourceLinks = (indices: readonly number[], group: string) =>
    indices.map((index, position) => (
      <DailyReportCitationControl
        key={index}
        testID={
          testIDPrefix
            ? `${testIDPrefix}-${group}-member-${position}`
            : undefined
        }
        title={t('dailyReport.sourceLink', { number: position + 1 })}
        transcript={transcript}
        disabled={busy}
        onPress={() => {
          load(index).catch(() => undefined);
        }}
      />
    ));
  return (
    <>
      <DailyReportCitationStrip
        transcript={transcript}
        testID={testIDPrefix ? `${testIDPrefix}-citation-strip` : undefined}
      >
        <DailyReportCitationControl
          testID={testIDPrefix ? `${testIDPrefix}-sources` : undefined}
          title={t('dailyReport.sources')}
          transcript={transcript}
          initial
          busy={busy}
          disabled={!resolve}
          onPress={() => {
            load().catch(() => undefined);
          }}
        />
        {sources?.statistics.map((members, index) => (
          <Fragment key={index}>
            <DailyReportCitationControl
              testID={
                testIDPrefix ? `${testIDPrefix}-statistic-${index}` : undefined
              }
              title={t('dailyReport.statisticCitation', {
                number: index + 1,
                count: members.length,
              })}
              transcript={transcript}
              expanded={expanded === index}
              onPress={() =>
                setExpanded(value => (value === index ? undefined : index))
              }
            />
            {expanded === index
              ? sourceLinks(members, `statistic-${index}`)
              : null}
          </Fragment>
        ))}
        {sources ? sourceLinks(sources.directSources, 'individual') : null}
        {sources?.otherSources.length ? (
          <>
            <DailyReportCitationControl
              testID={
                testIDPrefix ? `${testIDPrefix}-other-sources` : undefined
              }
              title={t('dailyReport.otherBackingSources', {
                count: sources.otherSources.length,
              })}
              transcript={transcript}
              expanded={otherExpanded}
              onPress={() => setOtherExpanded(value => !value)}
            />
            {otherExpanded ? sourceLinks(sources.otherSources, 'other') : null}
          </>
        ) : null}
      </DailyReportCitationStrip>
      {error ? (
        <AppText accessibilityRole="alert">
          {t('dailyReport.sourceError')}
        </AppText>
      ) : null}
    </>
  );
}
