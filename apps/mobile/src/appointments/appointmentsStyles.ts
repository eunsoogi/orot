import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

const styles = StyleSheet.create({
  container: {
    gap: 16,
    padding: 20,
    backgroundColor: appColors.background,
    flexGrow: 1,
  },
  scroll: { flex: 1 },
  title: { color: appColors.text, fontSize: 24, fontWeight: '700' },
  message: { color: appColors.secondary, fontSize: 15 },
  error: { color: appColors.danger },
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  clinic: { color: appColors.text, fontSize: 18, fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'flex-start', gap: 16 },
  form: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  formTitle: { color: appColors.text, fontSize: 18, fontWeight: '600' },
  input: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: appColors.text,
    padding: 12,
  },
  note: { minHeight: 48 },
  hint: { color: appColors.secondary, fontSize: 13 },
});

export default styles;
