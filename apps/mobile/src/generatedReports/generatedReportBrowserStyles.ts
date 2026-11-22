import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';
import { materialLibraryStyles } from '../layout/MaterialLibraryRows';

const detail = StyleSheet.create({
  panel: {
    gap: 12,
    padding: 16,
    backgroundColor: appColors.surface,
    borderRadius: 16,
  },
  heading: { fontSize: 20, fontWeight: '600' },
  // Match the original action's minimum height when it becomes the end notice.
  pagination: { minHeight: 48, justifyContent: 'center', gap: 8 },
});

export const generatedReportBrowserStyles = {
  ...detail,
  library: materialLibraryStyles.screen,
  libraryHeading: materialLibraryStyles.heading,
  libraryDescription: materialLibraryStyles.description,
};
