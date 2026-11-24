import { useRef, useState, type RefObject } from 'react';
import { Linking } from 'react-native';
import type { SavedArchivedCitation } from '../ragConversation/savedArchivedCitations';
import { openGeneratedReportReader } from './readers';
import { savedReportPublicCitationUrl } from './savedReportPublicCitation';
import { watchSavedReportNativeProtection } from './savedReportNativeProtection';
import type {
  GeneratedReportCitationSelection,
  GeneratedReportDetail,
  GeneratedReportRow,
} from './types';
import {
  beginSavedReportBrowserTrip,
  type SavedReportSourceTrip,
} from './useSavedReportBrowserReturn';

/** Press-only lookup owned by the exact currently displayed, protected Records read. */
export function useSavedReportPublicCitation() {
  const running = useRef<AbortController | null>(null);
  const [failedOwner, setFailedOwner] = useState<AbortSignal>();

  async function open(
    selection: GeneratedReportCitationSelection,
    citation: Pick<SavedArchivedCitation, 'kind' | 'publicOrdinal'>,
    ownerSignal: AbortSignal,
    isCurrent: () => boolean,
    revokeReport: () => void,
    beginExternalTrip: () => () => void,
  ) {
    if (ownerSignal.aborted || !isCurrent()) return;
    running.current?.abort();
    const controller = new AbortController();
    const { signal } = controller;
    running.current = controller;
    const abort = () => controller.abort();
    ownerSignal.addEventListener('abort', abort, { once: true });
    setFailedOwner(undefined);
    const current = () =>
      !signal.aborted && !ownerSignal.aborted && isCurrent();
    let cancelTrip: (() => void) | undefined;
    const protection = watchSavedReportNativeProtection(signal, () => {
      if (current()) revokeReport();
      controller.abort();
    });
    try {
      if (!protection || !(await protection.confirm()) || !current()) return;
      const archive = (await openGeneratedReportReader()).archivedSources;
      if (!current() || !(await protection.confirm()) || !current()) return;
      const selected = await archive?.resolve(
        selection.target,
        selection.ordinal,
        signal,
      );
      if (!current() || !(await protection.confirm()) || !current()) return;
      const url =
        selected?.kind === 'external'
          ? savedReportPublicCitationUrl(citation, selected.reference)
          : undefined;
      if (!url) {
        setFailedOwner(ownerSignal);
        return;
      }
      cancelTrip = beginExternalTrip();
      await Linking.openURL(url);
    } catch {
      cancelTrip?.();
      if (current()) setFailedOwner(ownerSignal);
    } finally {
      protection?.dispose();
      ownerSignal.removeEventListener('abort', abort);
      if (running.current === controller) running.current = null;
    }
  }

  return { open, failedOwner };
}

/** Dispatch only the pill object belonging to the exact current rendered report. */
export function openSavedReportCitation({
  row,
  detail,
  selection,
  citation,
  owner,
  isCurrent,
  invalidate,
  sourceTrip,
  scroll,
  openReportSource,
  externalCitation,
}: {
  readonly row: GeneratedReportRow;
  readonly detail: GeneratedReportDetail;
  readonly selection: GeneratedReportCitationSelection;
  readonly citation: SavedArchivedCitation;
  readonly owner: AbortController;
  readonly isCurrent: () => boolean;
  readonly invalidate: () => void;
  readonly sourceTrip: RefObject<SavedReportSourceTrip | undefined>;
  readonly scroll:
    | { readonly preserve: () => void; readonly restore: () => void }
    | null
    | undefined;
  readonly openReportSource: (
    selection: GeneratedReportCitationSelection,
  ) => boolean;
  readonly externalCitation: ReturnType<typeof useSavedReportPublicCitation>;
}) {
  if (
    !isCurrent() ||
    !detail.conversationSources?.citations.includes(citation) ||
    detail.conversationSources.target !== selection.target ||
    selection.target.turnId !== row.id ||
    selection.target.createdAt !== row.createdAt
  )
    return;
  if (citation.kind === 'public_web' || citation.kind === 'external_medical') {
    externalCitation.open(
      selection,
      citation,
      owner.signal,
      isCurrent,
      invalidate,
      () =>
        beginSavedReportBrowserTrip(
          sourceTrip,
          selection.target,
          scroll,
          invalidate,
        ),
    );
    return;
  }
  if (citation.kind !== 'personal_record') return;
  sourceTrip.current = {
    phase: 'leaving',
    surface: 'stack',
    target: selection.target,
  };
  scroll?.preserve();
  if (!openReportSource(selection)) sourceTrip.current = undefined;
}
