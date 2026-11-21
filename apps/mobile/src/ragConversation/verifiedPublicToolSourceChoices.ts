import type { EvidenceReference } from '@orot/agent-runtime';
import { isSafeEuropePmcArticleUrl } from '../aiFeatures/integration/articleLinks';
import {
  isPublicWebReference,
  publicWebSources,
} from '../externalMedicalEvidence/publicWebSources';
import { sourceKindLabel } from './ConversationToolEventPresentation';

/** Only the verified live reference may produce a browser action. */
export function verifiedPublicToolSourceChoices(reference: EvidenceReference) {
  if (reference.sourceKind !== 'external_medical') return undefined;
  if (isPublicWebReference(reference)) return publicWebSources(reference);
  const locator = reference.locator as Record<string, unknown> | null;
  if (
    typeof locator?.originalUrl !== 'string' ||
    !isSafeEuropePmcArticleUrl(locator.originalUrl)
  )
    return undefined;
  return [
    {
      title:
        typeof locator.title === 'string'
          ? locator.title
          : sourceKindLabel(reference.sourceKind),
      url: locator.originalUrl,
    },
  ];
}
