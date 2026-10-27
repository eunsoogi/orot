import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Ordinary flexible layouts retain system text scaling; shared navigation supplies actual occupied-edge insets. */
export const healthReviewStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.background },
  container: { padding: 24, gap: 16 },
  section: { gap: 12 },
  form: { gap: 16 },
  reading: { gap: 8 },
  probe: { flex: 1 },
});
