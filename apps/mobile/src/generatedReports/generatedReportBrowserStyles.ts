import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const generatedReportBrowserStyles = StyleSheet.create({
  panel: {
    gap: 12,
    padding: 16,
    backgroundColor: appColors.surface,
    borderRadius: 16,
  },
  heading: { fontSize: 20, fontWeight: '600' },
});
