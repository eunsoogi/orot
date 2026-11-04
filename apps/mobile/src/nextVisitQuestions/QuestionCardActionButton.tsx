import { Pressable, Text } from 'react-native';
import type { NextVisitQuestionsTheme } from './types';
import { createQuestionCardStyles } from './questionCardStyles';

/** Keep question editing actions consistent with the current theme. */
export function ActionButton({
  accessibilityLabel,
  disabled,
  onPress,
  theme,
  testID,
  title,
}: {
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
  theme: NextVisitQuestionsTheme;
  testID: string;
  title: string;
}) {
  const styles = createQuestionCardStyles(theme);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, disabled && styles.disabled]}
      testID={testID}
    >
      <Text style={styles.actionText}>{title}</Text>
    </Pressable>
  );
}
