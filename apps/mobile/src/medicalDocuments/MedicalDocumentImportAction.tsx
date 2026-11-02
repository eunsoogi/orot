import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

interface MedicalDocumentImportActionProps {
  readonly opening: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

/** Keeps document import in the Records body instead of duplicating it in navigation actions. */
export function MedicalDocumentImportAction({
  opening,
  disabled,
  onPress,
}: MedicalDocumentImportActionProps) {
  const label = t('medicalDocument.import.title');
  const content = (
    <>
      <View style={styles.icon}>
        <AppSymbol name="doc.text" color={appColors.primaryText} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.summary}>
          {opening
            ? t('medicalDocument.import.opening')
            : t('medicalDocument.import.summary')}
        </Text>
      </View>
      <AppSymbol name="chevron.right" size={16} color={appColors.secondary} />
    </>
  );
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.card, disabled && styles.disabled]}
      testID="records-import-medical-document"
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 16,
    minHeight: 88,
    paddingHorizontal: 18,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 14,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  copy: { flex: 1, gap: 4 },
  title: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  summary: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  disabled: { opacity: 0.55 },
});
