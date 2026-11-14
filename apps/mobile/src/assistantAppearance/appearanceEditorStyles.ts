import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Shared responsive onboarding geometry; no saved preference state lives here. */
export const appearanceEditorStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.background },
  content: {
    flexGrow: 1,
    padding: 24,
    gap: 16,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 24,
  },
  preview: { alignItems: 'center', gap: 16, paddingVertical: 20 },
  previewDisc: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.primarySoft,
  },
  previewName: { fontSize: 22, fontWeight: '600', textAlign: 'center' },
  choiceDisc: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.surface,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  choice: {
    minWidth: 72,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 8,
    borderRadius: 16,
  },
  selected: { borderWidth: 2, borderColor: appColors.primaryText },
  input: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 12,
    color: appColors.text,
    backgroundColor: appColors.surface,
  },
  error: { color: appColors.danger },
});
