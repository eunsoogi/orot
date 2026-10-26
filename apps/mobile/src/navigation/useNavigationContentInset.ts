import { createContext, useContext } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  NAVIGATION_CONTENT_GAP,
  navigationContentInsetStyle,
  resolveNavigationOcclusion,
  type NavigationOcclusion,
} from './navigationLayout';

export const NavigationOcclusionContext =
  createContext<NavigationOcclusion | null>(null);

/** Returns the shell's shared four-edge reservation and additional scroll clearance. */
export function useNavigationOcclusion(): NavigationOcclusion {
  const occlusion = useContext(NavigationOcclusionContext);
  const insets = useContext(SafeAreaInsetsContext);
  return (
    occlusion ??
    resolveNavigationOcclusion({
      placement: 'bottom',
      reservedRightWidth: 0,
      systemBottomInset: 0,
      measuredBottomActionOcclusion: null,
      systemInsets: {
        top: insets?.top ?? 0,
        right: insets?.right ?? 0,
        bottom: insets?.bottom ?? 0,
        left: insets?.left ?? 0,
      },
    })
  );
}

/** Keeps the existing paddingBottom API while applying any newly occupied edge. */
export function useNavigationContentInset(gap = NAVIGATION_CONTENT_GAP) {
  return navigationContentInsetStyle(
    useNavigationOcclusion().scrollContentInsets,
    gap,
  );
}
