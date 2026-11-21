import { explicitConversationLiteratureRoute } from './explicitConversationLiteratureRoute';
import type { JsonObject } from '@orot/model-runtime';
import type { DefaultPublicSearchResult } from './defaultPublicSearch';

/** Display and budget history only. This is never authorization to dispatch another search. */
export interface ColdConversationSearch {
  version: 1;
  status: Exclude<DefaultPublicSearchResult['status'], 'cancelled'>;
  charged: boolean;
  literatureOnly?: true;
}

/** Old no-initial-search snapshots lack exact preflight history and remain unsupported. */
export function readColdConversationSearch(
  reconstruction: JsonObject,
): ColdConversationSearch | undefined {
  const invocation = reconstruction.invocation as {
    initialSearch?: unknown;
    request?: unknown;
    context?: { intent?: unknown };
  };
  if (invocation?.initialSearch) return undefined;
  const saved =
    reconstruction.publicSearch as unknown as ColdConversationSearch;
  if (
    !saved ||
    saved.version !== 1 ||
    typeof saved.charged !== 'boolean' ||
    (saved.literatureOnly !== undefined &&
      (saved.literatureOnly !== true ||
        saved.charged ||
        saved.status !== 'unavailable' ||
        typeof invocation?.request !== 'string' ||
        !explicitConversationLiteratureRoute(
          invocation.request,
          invocation.context?.intent,
        ))) ||
    !['success', 'empty', 'consent_required', 'unavailable'].includes(
      saved.status,
    )
  )
    throw new Error('Cold initial-search contract unavailable.');
  return {
    version: 1,
    status: saved.status,
    charged: saved.charged,
    ...(saved.literatureOnly ? { literatureOnly: true as const } : {}),
  };
}
