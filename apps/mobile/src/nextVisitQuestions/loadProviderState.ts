import type { ProviderViewState } from './types';
import { nextVisitQuestionsCopy as copy } from './copy';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

/** Converts lookup failures into a recoverable state without exposing provider errors. */
export async function loadProviderState<T>(
  resolve: () => Promise<T>,
  project: (result: T) => ProviderViewState,
): Promise<ProviderViewState> {
  try {
    return project(await resolve());
  } catch {
    return { status: 'error', selection: null, message: copy.provider.error };
  }
}

/** Retry a failed lookup; otherwise let the person choose a provider. */
export function useProviderSelection<T>(
  resolve: () => Promise<T>,
  project: (result: T) => ProviderViewState,
  revision: number,
  generationRequest: MutableRefObject<number>,
  choose: () => void,
) {
  const [provider, setProvider] = useState<ProviderViewState>({
    status: 'loading',
    selection: null,
  });
  const [providerRetry, setProviderRetry] = useState(0);
  const providerRequest = useRef(0);
  useEffect(() => {
    const request = ++providerRequest.current;
    // A refresh invalidates earlier lookups and any generation using the prior selection.
    generationRequest.current += 1;
    setProvider({ status: 'loading', selection: null });
    loadProviderState(resolve, project).then(result => {
      if (providerRequest.current === request) setProvider(result);
    });
    return () => {
      providerRequest.current += 1;
    };
  }, [resolve, project, revision, providerRetry, generationRequest]);
  const openProviderSelection = useCallback(() => {
    if (provider.status === 'error') setProviderRetry(value => value + 1);
    else choose();
  }, [provider.status, choose]);
  const invalidateProviderLookup = useCallback(() => {
    providerRequest.current += 1;
  }, []);
  return {
    provider,
    setProvider,
    openProviderSelection,
    invalidateProviderLookup,
  };
}
