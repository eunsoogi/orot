import { createContext, useContext, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import type { SavedArchivedCitation } from './savedArchivedCitations';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { ColdConversationSourceOwner } from '../aiFeatures/integration/coldConversationSourceResolvers';
import { isSafeEuropePmcArticleUrl } from '../aiFeatures/integration/articleLinks';
import { publicWebSources } from '../externalMedicalEvidence/publicWebSources';

export type ArchivedCitationTarget = Readonly<{
  sessionId: string;
  sessionVersion: number;
  turnId: string;
  createdAt: string;
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
      if (citation.kind === 'public_web') {
        const url = publicWebSources(selected.reference)?.[
          citation.publicOrdinal ?? 0
        ]?.url;
        if (!url) return onLinkError();
        await Linking.openURL(url);
        return;
      }
      const locator = selected.reference.locator;
      const url =
        locator &&
        typeof locator === 'object' &&
        'originalUrl' in locator &&
        typeof locator.originalUrl === 'string'
          ? locator.originalUrl
          : '';
      if (!isSafeEuropePmcArticleUrl(url)) return onLinkError();
      await Linking.openURL(url);
    } catch {
      if (!signal.aborted) onLinkError();
    }
  };
}
