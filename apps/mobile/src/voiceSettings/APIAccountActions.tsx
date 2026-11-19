import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { t } from '../i18n';

/** Sibling icon actions preserve the existing account callbacks; neither reads a credential. */
export function APIAccountActions({
  disabled,
  busy,
  editing,
  onEdit,
  onRemove,
}: {
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  return (
    <View style={actionStyles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('modelSettings.editApiKey')}
        accessibilityState={{ disabled: disabled || editing, busy }}
        disabled={disabled || editing}
        style={styles.action}
        onPress={onEdit}
        testID="openai-api-key-edit"
      >
        <AppSymbol name="pencil" size={18} color={appColors.primary} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('modelSettings.logoutApi')}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        style={styles.action}
        onPress={onRemove}
        testID="openai-api-key-remove"
      >
        <AppSymbol
          name="rectangle.portrait.and.arrow.right"
          size={18}
          color={appColors.primary}
        />
      </Pressable>
    </View>
  );
}

const actionStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
