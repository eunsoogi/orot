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
});

export const generatedReportBrowserStyles = {
  ...detail,
  library: materialLibraryStyles.screen,
  libraryHeading: materialLibraryStyles.heading,
  libraryDescription: materialLibraryStyles.description,
};
