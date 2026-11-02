import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

interface MedicalDocumentImportActionProps {
  readonly opening: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly showDivider?: boolean;
}

/** Keeps document import in the Records body instead of duplicating it in navigation actions. */
export function MedicalDocumentImportAction({
  opening,
  disabled,
  onPress,
  showDivider = false,
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
      style={[
        styles.row,
        showDivider && styles.divider,
        disabled && styles.disabled,
      ]}
      testID="records-import-medical-document"
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 70,
    minWidth: 0,
    paddingVertical: 9,
  },
  divider: {
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  title: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  summary: { color: appColors.secondary, fontSize: 14, lineHeight: 19 },
  disabled: { opacity: 0.55 },
});
