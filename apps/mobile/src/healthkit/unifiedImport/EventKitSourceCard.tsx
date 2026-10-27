import { Pressable, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
import { CheckboxIndicator } from '../../layout/CheckboxIndicator';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import { unifiedImportStyles as styles } from './unifiedImportStyles';

/** Keeps calendar opt-in with source choices while candidate review stays in the activity panel. */
export function EventKitSourceCard({
  selected,
  disabled,
  reviewing = false,
  onToggle,
}: {
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly reviewing?: boolean;
  readonly onToggle: () => void;
}) {
  if (reviewing) {
    return (
      <View style={styles.card}>
        <Text style={styles.caption}>
          {t('healthkit.unifiedImport.reviewSource')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled }}
        disabled={disabled}
        onPress={onToggle}
        style={styles.provider}
        testID="unified-import-toggle-eventKit"
      >
        <View style={styles.providerIcon}>
          <AppSymbol name="calendar" color={appColors.primaryText} />
        </View>
        <View style={styles.providerText}>
          <Text style={styles.sectionTitle}>캘린더</Text>
          <Text style={styles.caption}>
            {t('healthkit.unifiedImport.calendarLabel')}
          </Text>
        </View>
        <CheckboxIndicator
          checked={selected}
          disabled={disabled}
          testID="unified-import-indicator-eventKit"
        />
      </Pressable>
    </View>
  );
}
