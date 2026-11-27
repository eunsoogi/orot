import { Alert, Pressable, StyleSheet } from 'react-native';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { AppSymbol } from '../layout/AppSymbol';

/** Explanations are accessible independently of the setting and never perform writes. */
export function SettingsInformationButton({
  title,
  message,
  testID,
}: {
  readonly title: string;
  readonly message: string;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('settings.informationFor', { title })}
      onPress={() => Alert.alert(title, message)}
      style={styles.touchTarget}
      testID={testID}
    >
      <AppSymbol name="info.circle" size={19} color={appColors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touchTarget: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
