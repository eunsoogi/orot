import type { ReactNode } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { styles } from './ConversationScreen.styles';

interface SourcePillProps {
  readonly testID?: string;
  readonly label: string;
  readonly hint?: string;
  readonly caption: string;
  readonly icon: 'book' | 'doc.text' | 'globe';
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly expanded?: boolean;
  readonly onPress: () => void;
}

/** Source capabilities keep their own press resolver; this is shared presentation only. */
export function ConversationSourcePill({
  testID,
  label,
  hint,
  caption,
  icon,
  disabled,
  busy,
  expanded,
  onPress,
}: SourcePillProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={icon === 'globe' ? 'link' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{
        disabled: Boolean(disabled || busy),
        busy,
        expanded,
      }}
      disabled={disabled || busy}
      style={styles.source}
      onPress={onPress}
    >
      <AppSymbol name={icon} color={appColors.primaryText} size={18} />
      <Text numberOfLines={1} style={styles.sourceText}>
        {caption}
      </Text>
    </Pressable>
  );
}

/** A contextual citation strip does not take the composer focus or inherit shell rail bleed. */
export function ConversationCitationStrip({
  children,
  testID = 'rag-conversation-sources',
}: {
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  return (
    <ScrollView
      testID={testID}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      style={styles.sourcesViewport}
      contentContainerStyle={styles.sources}
    >
      {children}
    </ScrollView>
  );
}
