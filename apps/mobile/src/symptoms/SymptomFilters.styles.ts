import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

export default StyleSheet.create({
  filterCard: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  sectionTitle: { color: appColors.text, fontSize: 15, fontWeight: '600' },
  hint: { color: appColors.secondary, fontSize: 13 },
  error: { color: appColors.danger },
  // Date and time inputs wrap when a narrow region cannot fit readable controls.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  input: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: appColors.text,
    minHeight: 44,
    padding: 10,
  },
  halfInput: { flexBasis: 140, flexGrow: 1, minWidth: 140 },
  choice: {
    alignItems: 'center',
    borderColor: appColors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 80,
    flexGrow: 1,
    minHeight: 44,
    minWidth: 80,
    padding: 10,
  },
  choiceLabel: { color: appColors.text },
  selectedChoice: {
    backgroundColor: appColors.primarySoft,
    borderColor: appColors.primaryText,
  },
});
