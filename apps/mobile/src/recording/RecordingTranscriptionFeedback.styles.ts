import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export const recordingTranscriptionFeedbackStyles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    gap: 10,
    padding: 12,
  },
  error: { color: appColors.danger },
});
