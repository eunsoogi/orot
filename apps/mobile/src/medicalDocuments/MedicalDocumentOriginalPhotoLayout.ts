import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Keeps the original-photo viewport within the saved detail's measured content column. */
export const medicalDocumentOriginalPhotoStyles = StyleSheet.create({
  panel: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    marginHorizontal: 20,
    marginVertical: 12,
    minWidth: 0,
    padding: 16,
  },
  title: { color: appColors.text, fontSize: 18, fontWeight: '700' },
  viewport: {
    backgroundColor: appColors.background,
    borderRadius: 12,
    height: 320,
    overflow: 'hidden',
    width: '100%',
  },
  fullScreenViewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  zoomView: { flex: 1 },
  zoomContent: { flexGrow: 1 },
  image: { height: '100%', width: '100%' },
  status: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
  },
  statusText: {
    color: appColors.secondary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  zoomControls: { alignItems: 'center', flexDirection: 'row', gap: 8 },
});
