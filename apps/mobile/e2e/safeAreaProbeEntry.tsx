// This fixture exercises the shared layout without health, calendar, or provider access.
import { useState } from 'react';
import {
  AppRegistry,
  Button,
  PixelRatio,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { name as appName } from '../app.json';
import SafeAreaLayout from '../src/layout/SafeAreaLayout';

function SafeAreaProbeEntry() {
  const [value, setValue] = useState('');
  const [actionCompleted, setActionCompleted] = useState(false);
  const largeTextEnabled = PixelRatio.getFontScale() >= 1.5;

  return (
    <SafeAreaLayout scrollable>
      <View style={styles.content}>
        <Text accessibilityRole="header">Safe area keyboard probe</Text>
        <Text
          accessible
          accessibilityLabel={
            largeTextEnabled ? 'large-text-enabled' : 'large-text-disabled'
          }
          testID="safe-area-large-text-state"
        >
          Font scale: {PixelRatio.getFontScale()}
        </Text>
        <TextInput
          accessibilityLabel="Keyboard test input"
          onChangeText={setValue}
          placeholder="Enter a note"
          testID="safe-area-keyboard-input"
          value={value}
        />
        {Array.from({ length: 12 }, (_, index) => (
          <Text key={index}>Scrollable section {index + 1}</Text>
        ))}
        {actionCompleted ? (
          <Text testID="safe-area-keyboard-action-done">Action completed</Text>
        ) : (
          <Button
            onPress={() => setActionCompleted(true)}
            testID="safe-area-keyboard-action"
            title="Continue"
          />
        )}
      </View>
    </SafeAreaLayout>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 18, padding: 24 },
});

AppRegistry.registerComponent(appName, () => SafeAreaProbeEntry);
