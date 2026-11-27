import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { SettingsInformationButton } from './SettingsInformationButton';

export function SettingsMemoryControl({
  title,
  description,
  testID,
  control,
  children,
}: {
  readonly title: string;
  readonly description: readonly string[];
  readonly testID: string;
  readonly control?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.row}>
        <AppText accessibilityRole="header" style={styles.title}>
          {title}
        </AppText>
        <SettingsInformationButton
          title={title}
          message={description.join('\n\n')}
          testID={`${testID}-info`}
        />
        {control}
      </View>
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 10, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: appColors.text, fontSize: 16, fontWeight: '600', flex: 1 },
});
