import { useCallback, useEffect, useRef, useState } from 'react';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { EvidenceSourceDetailScreen } from '../aiFeatures/integration/EvidenceSourceDetailScreen';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { useGeneratedReportAccess } from './useGeneratedReportAccess';
import type {
  GeneratedReportCitationSelection,
  GeneratedReportReader,
} from './types';
import { openGeneratedReportReader } from './readers';

const unavailable = { status: 'unavailable' } as const;
const denyGenericRead = async () => unavailable;
type Archive = NonNullable<GeneratedReportReader['archivedSources']>;
type LocalCitation = Extract<
  Awaited<ReturnType<Archive['resolve']>>,
  { readonly kind: 'detail' }
>;

/** The child receives IDs only and reopens only the selected source under its own route lease. */
export function GeneratedReportSourceDestination({
  selection,
  active,
  routeKey,
  ownership,
  onBack,
}: {
  readonly selection: GeneratedReportCitationSelection;
  readonly active: boolean;
  readonly routeKey: string;
  readonly ownership?: NavigationRouteOwnership;
  readonly onBack: () => void;
}) {
  const [result, setResult] = useState<{
    readonly citation: LocalCitation;
    readonly controller: AbortController;
    readonly archive: Archive;
  } | null>();
  const [blocked, setBlocked] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const abort = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
  }, []);
  const clear = useCallback(() => {
    abort();
    setResult(null);
    setBlocked(true);
  }, [abort]);
  // Route blur, deletion and local clear invalidate both render and inner reads.
  const { canAccess } = useGeneratedReportAccess(
    active,
    ownership,
    clear,
    abort,
    true,
  );
  useEffect(() => {
    if (!canAccess()) return;
    const controller = new AbortController();
    pending.current = controller;
    const { signal } = controller;
    setResult(undefined);
    setBlocked(false);
    const settle = (value: LocalCitation | null, archive?: Archive) => {
      if (!signal.aborted && pending.current === controller && canAccess())
        setResult(
          value && archive ? { citation: value, controller, archive } : null,
        );
    };
    async function resolve() {
      const archive = (await openGeneratedReportReader()).archivedSources;
      if (!archive || signal.aborted || !canAccess()) return settle(null);
      const source = await archive.resolve(
        selection.target,
        selection.ordinal,
        signal,
      );
      settle(
        source?.kind === 'detail' &&
          source.reference.sourceKind === 'personal_record'
          ? source
          : null,
        archive,
      );
    }
    resolve().catch(() => settle(null));
    return () => controller.abort();
  }, [active, canAccess, selection]);
  if (!active || ownership?.isCurrent() === false) return null;
  if (blocked || result === null)
    return (
      <AppText
        accessibilityRole="alert"
        testID="generated-report-source-unavailable"
      >
        {t('aiFeatures.source.unavailable')}
      </AppText>
    );
  if (!result)
    return (
      <AppText accessibilityLiveRegion="polite">
        {t('aiFeatures.source.loading')}
      </AppText>
    );

  const { citation, controller, archive } = result;
  const owns = () =>
    pending.current === controller && !controller.signal.aborted && canAccess();
  return (
    <EvidenceSourceDetailScreen
      navigationRouteKey={routeKey}
      reference={citation.reference}
      sourceOwner={citation.owner}
      onBack={onBack}
      readSource={denyGenericRead}
      readColdSource={async (owner, reference, signal) => {
        if (
          !owns() ||
          signal.aborted ||
          owner !== citation.owner ||
          reference !== citation.reference
        )
          return unavailable;
        // A native pop revokes route ownership before the viewer's effect
        // cleanup. Either owner must stop admission to later archive reads.
        const ownerSignal = controller.signal;
        const read = new AbortController();
        const abortRead = () => read.abort();
        ownerSignal.addEventListener('abort', abortRead, { once: true });
        signal.addEventListener('abort', abortRead, { once: true });
        try {
          const source = await archive.read(owner, reference, read.signal);
          return owns() && !read.signal.aborted ? source : unavailable;
        } finally {
          ownerSignal.removeEventListener('abort', abortRead);
          signal.removeEventListener('abort', abortRead);
        }
      }}
    />
  );
}
