import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Screen spacing stays inside the shell-provided content frame without another rail deduction. */
export const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    gap: 16,
    padding: 24,
    backgroundColor: appColors.background,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    color: appColors.text,
    fontSize: 30,
    fontWeight: '700',
    flexShrink: 1,
  },
  message: { color: appColors.secondary, fontSize: 16 },
  provenanceNote: { color: appColors.secondary, fontSize: 14 },
  error: { color: appColors.danger },
});
