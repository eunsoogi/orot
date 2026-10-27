import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Ordinary flexible layouts retain system text scaling; shared navigation supplies actual occupied-edge insets. */
export const healthReviewStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.background },
  container: { padding: 24, gap: 16 },
  heading: { gap: 8 },
  panel: { minWidth: 0, gap: 16 },
  actions: { gap: 12 },
  requests: { gap: 12 },
  request: { gap: 8 },
  section: { gap: 12 },
  form: { gap: 16 },
  reading: { gap: 8 },
  probe: { flex: 1 },
});
