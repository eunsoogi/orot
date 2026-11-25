import { useCallback, useLayoutEffect, useRef } from 'react';

/** The memoized body must keep the current link error action without repainting old replies. */
export function useConversationMarkdownLinkError(onLinkError: () => void) {
  const current = useRef(onLinkError);
  useLayoutEffect(() => {
    current.current = onLinkError;
  }, [onLinkError]);
  return useCallback(() => current.current(), []);
}
