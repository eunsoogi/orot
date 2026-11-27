import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';

const minimumTarget = 44;

function targetPadding(size: number) {
  return size > 0 ? Math.max(0, (minimumTarget - size) / 2) : 0;
}

/** Center the native switch on the wrapping label, never on explanatory footer copy. */
export function SettingsNotificationToggleRow({
  label,
  hint,
  disabled,
  value,
  onToggle,
  testID,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly disabled: boolean;
  readonly value: boolean;
  readonly onToggle: () => void;
  readonly testID: string;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  return (
    <View style={styles.row} testID={`${testID}-toggle-row`}>
      <View style={styles.labelTarget} testID={`${testID}-toggle-label-target`}>
        <Text style={styles.label} testID={`${testID}-toggle-label`}>
          {label}
        </Text>
      </View>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        onPress={onToggle}
        style={[
          styles.control,
          {
            paddingHorizontal: targetPadding(size.width),
            paddingVertical: targetPadding(size.height),
          },
        ]}
        testID={`${testID}-switch`}
      >
        {/* Only the wrapper accepts input and exposes the switch state. */}
        <Switch
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          value={value}
          disabled={disabled}
          testID={`${testID}-switch-visual`}
          onLayout={({
            nativeEvent: {
              layout: { width, height },
            },
          }) => {
            setSize(current =>
              current.width === width && current.height === height
                ? current
                : { width, height },
            );
          }}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  labelTarget: {
    flex: 1,
    minWidth: 0,
    minHeight: minimumTarget,
    justifyContent: 'center',
  },
  label: { color: appColors.text, fontSize: 17 },
  control: {
    flexShrink: 0,
    minWidth: minimumTarget,
    minHeight: minimumTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
