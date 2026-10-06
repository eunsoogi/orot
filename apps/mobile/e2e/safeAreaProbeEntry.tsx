// This fixture exercises the shared layout without health, calendar, or provider access.
import { useEffect, useState } from 'react';
import {
  AppRegistry,
  Button,
  Keyboard,
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
  const [keyboardFrame, setKeyboardFrame] = useState<{
    screenY: number;
    height: number;
  } | null>(null);
  const largeTextEnabled = PixelRatio.getFontScale() >= 1.5;

  useEffect(() => {
    // Read the native keyboard frame because Detox has no supported keyboard-frame matcher.
    const updateFrame = (event: {
      endCoordinates: { screenY: number; height: number };
    }) => {
      setKeyboardFrame({
        screenY: event.endCoordinates.screenY,
        height: event.endCoordinates.height,
      });
    };
    const shown = Keyboard.addListener('keyboardDidShow', updateFrame);
    // Clear as dismissal starts so scrolling cannot pass with a closing keyboard.
    const hiding = Keyboard.addListener('keyboardWillHide', () =>
      setKeyboardFrame(null),
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () =>
      setKeyboardFrame(null),
    );

    return () => {
      shown.remove();
      hiding.remove();
      hidden.remove();
    };
  }, []);

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
        <Text
          accessible
          accessibilityLabel={
            keyboardFrame
              ? `keyboard-visible:${keyboardFrame.screenY}:${keyboardFrame.height}`
              : 'keyboard-hidden'
          }
          testID="safe-area-keyboard-state"
        >
          Keyboard {keyboardFrame ? 'visible' : 'hidden'}
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
