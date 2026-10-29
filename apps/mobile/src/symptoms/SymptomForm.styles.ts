import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export default StyleSheet.create({
  slider: { minHeight: 48 },
  fullContentLane: { minWidth: 0, width: '100%' },
  form: { gap: 16 },
  formTitle: { color: appColors.text, fontSize: 30, fontWeight: '600' },
  fieldLabel: { color: appColors.text, fontSize: 14, fontWeight: '500' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  section: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: 1,
    borderRadius: 16,
    gap: 12,
    padding: 16,
  },
  choiceLabel: { color: appColors.text, fontSize: 16 },
  error: { color: appColors.danger },
  input: {
    backgroundColor: appColors.surface,
    color: appColors.text,
    minHeight: 48,
    borderColor: appColors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  halfInput: { flexBasis: 140, flexGrow: 1, minWidth: 140 },
  description: { minHeight: 72, textAlignVertical: 'top' },
  choice: {
    borderColor: appColors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 140,
    flexGrow: 1,
    minHeight: 48,
    padding: 10,
  },
  selectedChoice: {
    backgroundColor: appColors.primarySoft,
    borderColor: appColors.primaryText,
  },
  hint: { color: appColors.secondary, fontSize: 13 },
});
