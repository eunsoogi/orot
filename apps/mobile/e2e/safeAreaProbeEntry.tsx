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
        <Text accessibilityRole="header">안전 영역과 키보드 확인</Text>
        <Text
          accessible
          accessibilityLabel={
            largeTextEnabled ? '큰 글자 사용 중' : '큰 글자 사용 안 함'
          }
          testID="safe-area-large-text-state"
        >
          글자 배율: {PixelRatio.getFontScale()}
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
          키보드 {keyboardFrame ? '표시' : '숨김'}
        </Text>
        <TextInput
          accessibilityLabel="메모 입력"
          onChangeText={setValue}
          placeholder="메모를 입력하세요"
          placeholderTextColor={appColors.secondary}
          style={styles.input}
          testID="safe-area-keyboard-input"
          value={value}
        />
        {Array.from({ length: 12 }, (_, index) => (
          <Text key={index}>스크롤 내용 {index + 1}</Text>
        ))}
        {actionCompleted ? (
          <Text testID="safe-area-keyboard-action-done">완료</Text>
        ) : (
          <Button
            onPress={() => setActionCompleted(true)}
            testID="safe-area-keyboard-action"
            title="계속"
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
