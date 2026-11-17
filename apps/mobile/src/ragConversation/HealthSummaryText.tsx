import { memo, type ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { AppText } from '../layout/AppText';
import { styles } from './ConversationScreen.styles';

/** Only primitive prose is memoized; sources, save state and clinical warnings remain live
 * in the parent. No callback or mutable evidence object can be retained by this boundary. */
export const HealthSummaryText = memo(function SummaryProse({
  text,
  title = false,
}: {
  readonly text: string;
  readonly title?: boolean;
}) {
  return (
    <AppText
      accessibilityRole={title ? 'header' : undefined}
      style={title ? titleStyle : styles.messageText}
      allowFontScaling
      adjustsFontSizeToFit={false}
    >
      {text}
    </AppText>
  );
});
// Preserve the existing style order: prose metrics override no title weight or color.
const titleStyle: ComponentProps<typeof AppText>['style'] = [
  StyleSheet.create({ title: { fontWeight: '600' } }).title,
  styles.messageText,
];
