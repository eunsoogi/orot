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
      <View style={styles.row} testID={`${testID}-row`}>
        <AppText
          accessibilityRole="header"
          style={styles.title}
          testID={`${testID}-title`}
        >
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
// React Native's iOS Switch sets alignSelf to flex-start, which overrides the row's alignment.
export const settingsMemorySwitchStyle = { alignSelf: 'center' } as const;

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 10, gap: 4 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: {
    color: appColors.text,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    alignSelf: 'center',
    flex: 1,
  },
});
