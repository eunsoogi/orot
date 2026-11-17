import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { ConversationReportSection } from './ConversationReportSection';
import { styles as conversationStyles } from './ConversationScreen.styles';
import type { parseConversationReport } from './conversationReportTemplate';

/** Render only explicit sections admitted by the presentation parser. This is not
 * clinical validation; callers still own final-result and source validation. */
export function ConversationReportText({
  report,
  testID,
}: {
  readonly report: NonNullable<ReturnType<typeof parseConversationReport>>;
  readonly testID?: string;
}) {
  return (
    <View testID={testID} style={styles.report}>
      <AppText
        accessibilityRole="header"
        selectable
        style={[conversationStyles.messageText, styles.title]}
      >
        {report.title}
      </AppText>
      {'introduction' in report ? (
        <AppText selectable style={conversationStyles.messageText}>
          {report.introduction}
        </AppText>
      ) : null}
      {report.sections.map((section, index) => (
        <ConversationReportSection key={index} title={section.title}>
          <AppText selectable style={conversationStyles.messageText}>
            {section.content}
          </AppText>
        </ConversationReportSection>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  report: { gap: 12 },
  title: { fontWeight: '700' },
});
