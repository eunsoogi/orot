import type { ProviderResult } from './contracts';

/** A separate public-query boundary cannot accept private conversation messages or tool history.
 * The caller owns query review/consent and workflow-call accounting before invoking it. */
export interface PublicWebSearchRequest {
  readonly query: string;
}

/** Cited model-generated explanation; citations are not fetched original page passages. */
export interface PublicWebSearchResponse {
  readonly text: string;
  readonly callCount: number;
  readonly citations: readonly { readonly url: string; readonly title: string }[];
}

export type PublicWebSearch = (
  request: PublicWebSearchRequest,
  options?: { readonly signal?: AbortSignal },
) => Promise<ProviderResult<PublicWebSearchResponse>>;
