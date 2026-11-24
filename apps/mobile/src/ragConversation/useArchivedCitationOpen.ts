import { createContext, useContext, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import type { SavedArchivedCitation } from './savedArchivedCitations';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { ColdConversationSourceOwner } from '../aiFeatures/integration/coldConversationSourceResolvers';
import { archivedCitationOriginalUrl } from './archivedCitationOriginalUrl';

export type ArchivedCitationTarget = Readonly<{
  sessionId: string;
  sessionVersion: number;
  turnId: string;
  createdAt: string;
  summary?: { readonly id: string; readonly revision: string };
}>;

export type ResolveArchivedCitation = (
  target: ArchivedCitationTarget,
  index: number,
  signal: AbortSignal,
) => Promise<
  | {
      readonly kind: 'detail';
      readonly reference: EvidenceReference;
      readonly owner: ColdConversationSourceOwner;
    }
  | { readonly kind: 'external'; readonly reference: EvidenceReference }
  | undefined
>;

export const ResolveArchivedCitationContext = createContext<
  ResolveArchivedCitation | undefined
>(undefined);

/** Press-only resolution, routed through the same detail navigation and safe
 * browser link checks as live sources. Closing/replacing this row cancels the
 * selected lookup; no lazy resolver is invoked by rendering the transcript. */
export function useArchivedCitationOpen(
  target: ArchivedCitationTarget | undefined,
  onOpenSource: (
    reference: EvidenceReference,
    owner?: ColdConversationSourceOwner,
  ) => void,
  onLinkError: () => void,
) {
  const resolve = useContext(ResolveArchivedCitationContext);
  const flight = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => flight.current?.abort(),
    [
      target?.sessionId,
      target?.sessionVersion,
      target?.turnId,
      target?.createdAt,
      target?.summary?.id,
      target?.summary?.revision,
      resolve,
    ],
  );

  return async (
    citation: SavedArchivedCitation & { readonly publicOrdinal?: number },
  ) => {
    if (!resolve || !target) return onLinkError();
    flight.current?.abort();
    const controller = new AbortController();
    flight.current = controller;
    const { signal } = controller;
    try {
      const selected = await resolve(target, citation.ordinal, signal);
      if (signal.aborted) return;
      if (!selected) return onLinkError();
      if (selected.kind === 'detail') {
        onOpenSource(selected.reference, selected.owner);
        return;
      }
      const url = archivedCitationOriginalUrl(citation, selected.reference);
      if (!url) return onLinkError();
      await Linking.openURL(url);
    } catch {
      if (!signal.aborted) onLinkError();
    }
  };
}
