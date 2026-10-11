import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';

/** Keeps transient overlays above the mounted feature destination. */
export const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1 },
  featureScreen: { flex: 1 },
  hiddenFeatureScreen: { display: 'none', flex: 1 },
  sourceOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: appColors.surface,
  },
});
