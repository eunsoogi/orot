// This fixture exercises the shared layout without health, calendar, or provider access.
import { useEffect, useState } from 'react';
import {
  AppRegistry,
  Button,
  Keyboard,
  PixelRatio,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { name as appName } from '../app.json';
import { formatNumber, t } from '../src/i18n';
import { AppText as Text } from '../src/layout/AppText';
import { appColors } from '../src/layout/appColors';
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
        <Text accessibilityRole="header">{t('probe.layout.title')}</Text>
        <Text
          accessible
          accessibilityLabel={t(
            largeTextEnabled
              ? 'probe.layout.largeTextEnabled'
              : 'probe.layout.largeTextDisabled',
          )}
          testID="safe-area-large-text-state"
        >
          {t('probe.layout.fontScale', {
            scale: formatNumber(PixelRatio.getFontScale()),
          })}
        </Text>
        {/* Detox waits on an ID because the dynamic label matcher timed out on iOS. */}
        <Text
          accessible
          accessibilityLabel={
            keyboardFrame
              ? `keyboard-visible:${keyboardFrame.screenY}:${keyboardFrame.height}`
              : 'keyboard-hidden'
          }
          testID={
            keyboardFrame
              ? 'safe-area-keyboard-visible'
              : 'safe-area-keyboard-hidden'
          }
        >
          {t(
            keyboardFrame
              ? 'probe.layout.keyboardVisible'
              : 'probe.layout.keyboardHidden',
          )}
        </Text>
        <TextInput
          accessibilityLabel={t('probe.layout.noteLabel')}
          onChangeText={setValue}
          placeholder={t('probe.layout.notePlaceholder')}
          placeholderTextColor={appColors.secondary}
          style={styles.input}
          testID="safe-area-keyboard-input"
          value={value}
        />
        {Array.from({ length: 12 }, (_, index) => (
          <Text key={index}>
            {t('probe.layout.scrollContent', {
              index: formatNumber(index + 1),
            })}
          </Text>
        ))}
        {actionCompleted ? (
          <Text testID="safe-area-keyboard-action-done">
            {t('probe.layout.done')}
          </Text>
        ) : (
          <Button
            onPress={() => setActionCompleted(true)}
            testID="safe-area-keyboard-action"
            title={t('probe.layout.continue')}
          />
        )}
      </View>
    </SafeAreaLayout>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 18, padding: 24 },
  input: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: appColors.text,
    minHeight: 48,
    paddingHorizontal: 12,
  },
});

AppRegistry.registerComponent(appName, () => SafeAreaProbeEntry);
