import { useContext } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { BOTTOM_NAVIGATION_CONTENT_INSET } from './navigationLayout';

/** Extra scroll space exposes the final control above the floating toolbar, including the home indicator. */
export function useNavigationContentInset() {
  const insets = useContext(SafeAreaInsetsContext);
  return {
    paddingBottom: BOTTOM_NAVIGATION_CONTENT_INSET + (insets?.bottom ?? 0),
  };
}
