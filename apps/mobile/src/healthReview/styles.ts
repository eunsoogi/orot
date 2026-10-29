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
  choice: {
    minHeight: 48,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
    justifyContent: 'flex-start',
  },
  choiceSelected: { backgroundColor: appColors.primarySoft },
  choiceLabel: { flexShrink: 1 },
  choiceMark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: appColors.secondary,
  },
  choiceMarkSelected: {
    borderColor: appColors.primary,
    backgroundColor: appColors.primary,
  },
  reading: { gap: 8 },
  input: {
    minHeight: 48,
    width: '100%',
    padding: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 12,
    backgroundColor: appColors.surface,
    color: appColors.text,
  },
  pickerScreen: { flex: 1, backgroundColor: appColors.background },
  pickerPage: { padding: 24, gap: 12 },
  probe: { flex: 1 },
});
