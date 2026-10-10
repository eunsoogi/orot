import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';

/** Keeps transient overlays above the mounted feature destination. */
export const styles = StyleSheet.create({
  container: { flex: 1 },
  providerBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  providerNotice: { color: appColors.secondary, flex: 1, fontSize: 12 },
  screen: { flex: 1 },
  featureScreen: { flex: 1 },
  hiddenFeatureScreen: { display: 'none', flex: 1 },
  sourceOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: appColors.surface,
  },
});
