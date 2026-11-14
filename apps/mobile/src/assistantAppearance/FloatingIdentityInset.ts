import { createContext, useContext } from 'react';

/** Inset scroll content, not the viewport, so history can move behind the floating identity. */
export const FloatingIdentityInset = createContext(0);
export function useFloatingIdentityInset() {
  return useContext(FloatingIdentityInset);
}
