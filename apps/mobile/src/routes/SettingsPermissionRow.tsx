import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { settingsListColors } from './settingsListColors';
import { SettingsInformationButton } from './SettingsInformationButton';

/** Permission notes are read-only; system grants remain owned by iOS. */
export function SettingsPermissionRow({
  detail,
  summary,
  testID,
  title,
}: {
  readonly detail?: string;
  readonly summary: string;
  readonly testID: string;
  readonly title: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{title}</Text>
      <SettingsInformationButton
        title={title}
        message={detail ? `${summary}\n\n${detail}` : summary}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: settingsListColors.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { flex: 1, color: appColors.text, fontSize: 16 },
});
