import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Shared layout for the visit record panel and its inline editor. */
export const styles = StyleSheet.create({
  panel: { padding: 20, gap: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  editor: { gap: 8 },
  action: { minHeight: 44, justifyContent: 'center' },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 8,
    padding: 10,
    color: appColors.text,
  },
});
