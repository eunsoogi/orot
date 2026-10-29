import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Fields and actions use dynamic semantic colors in the same growing page flow. */
export const styles = StyleSheet.create({
  form: {
    alignSelf: 'stretch',
    backgroundColor: appColors.surface,
    borderRadius: 20,
    gap: 16,
    padding: 20,
    width: '100%',
  },
  field: { gap: 8 },
  sectionTitle: { color: appColors.text, fontSize: 24, fontWeight: '600' },
  fieldLabel: { color: appColors.text, fontSize: 16, fontWeight: '600' },
  input: {
    backgroundColor: appColors.surface,
    color: appColors.text,
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 48,
    padding: 12,
    fontSize: 16,
  },
  detailsInput: { textAlignVertical: 'top' },
  error: { color: appColors.danger },
});
