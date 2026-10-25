import { createContext, useContext } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  BOTTOM_NAVIGATION_CONTENT_INSET,
  NAVIGATION_CONTENT_GAP,
} from './navigationLayout';

export const NavigationContentInsetContext = createContext<number | null>(null);

/** Extra scroll space exposes the final control above the floating toolbar, including the home indicator. */
export function useNavigationContentInset(gap = NAVIGATION_CONTENT_GAP) {
  const insets = useContext(SafeAreaInsetsContext);
  const measuredHeight = useContext(NavigationContentInsetContext);
  return {
    // The measured overlay already includes its safe area and changes when the keyboard or text size changes.
    paddingBottom:
      (measuredHeight ??
        BOTTOM_NAVIGATION_CONTENT_INSET + (insets?.bottom ?? 0)) + gap,
  };
}
