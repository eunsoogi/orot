import type { EvidenceReference } from '@orot/agent-runtime';
import { useEffect, useRef, useState } from 'react';
import { beginSourceOpenTiming } from '../../providers/sourceOpenDiagnostic';
import { waitForSourcePresentation } from '../../ragConversation/publicSourcePresentation';
import type { ColdConversationSourceOwner } from './coldConversationSourceResolvers';
import type { EvidenceSourceReadResult } from './evidenceRegistry';

export type ScreenState =
  { readonly status: 'loading' } | EvidenceSourceReadResult;

type Request = {
  readonly reference: EvidenceReference;
  readonly sourceOwner?: ColdConversationSourceOwner;
  readonly readSource: (
    reference: EvidenceReference,
    signal: AbortSignal,
  ) => Promise<EvidenceSourceReadResult>;
  readonly readColdSource?: (
    owner: ColdConversationSourceOwner,
    reference: EvidenceReference,
    signal: AbortSignal,
  ) => Promise<EvidenceSourceReadResult>;
  readonly attempt: number;
};

const localHeaderFallbackMs = 160;
const pending: ScreenState = { status: 'loading' };

export function useEvidenceSourceDetailRead({
  reference,
  sourceOwner,
  readSource,
  readColdSource,
  attempt,
}: Request) {
  const timing = useRef<ReturnType<typeof beginSourceOpenTiming>>(undefined);
  const firstPresentationAdmitted = useRef(false);
  const reveal = useRef<() => void>(() => {});
  const reader = sourceOwner ? readColdSource : readSource;
  const [result, setResult] = useState<{
    reference: EvidenceReference;
    sourceOwner?: ColdConversationSourceOwner;
    attempt: number;
    reader: typeof reader;
    state: EvidenceSourceReadResult;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    const active = () => !controller.signal.aborted;
    const observation = beginSourceOpenTiming(
      controller.signal,
      'source_open_detail_start',
    );
    timing.current = observation;
    setResult(undefined);
    const readable = firstPresentationAdmitted.current
      ? undefined
      : waitForSourcePresentation(controller.signal, localHeaderFallbackMs);
    if (readable) reveal.current = readable.shown;
    const load = async () => {
      try {
        if ((readable && !(await readable.ready)) || !active()) return;
        // The fallback also admits this mounted scaffold; retries and source
        // switches do not wait for a layout event that may never repeat.
        firstPresentationAdmitted.current = true;
        const state = sourceOwner
          ? await (readColdSource?.(
              sourceOwner,
              reference,
              controller.signal,
            ) ??
              Promise.resolve<EvidenceSourceReadResult>({
                status: 'unavailable',
              }))
          : await readSource(reference, controller.signal);
        if (!active()) return;
        if (state.status === 'available')
          observation?.mark('source_open_detail_proof');
        setResult({ reference, sourceOwner, attempt, reader, state });
      } catch {
        if (active())
          setResult({
            reference,
            sourceOwner,
            attempt,
            reader,
            state: { status: 'unavailable' },
          });
      }
    };
    load();
    return () => {
      controller.abort();
      reveal.current = () => {};
    };
  }, [attempt, readSource, readColdSource, reader, reference, sourceOwner]);

  return {
    state:
      result?.reference === reference &&
      result.sourceOwner === sourceOwner &&
      result.attempt === attempt &&
      result.reader === reader
        ? result.state
        : pending,
    onHeaderLayout() {
      firstPresentationAdmitted.current = true;
      timing.current?.mark('source_open_detail_header');
      reveal.current();
    },
    onContentLayout() {
      timing.current?.mark('source_open_detail_ready');
    },
  };
}
