import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { ConversationReportSection } from './ConversationReportSection';
import { styles as conversationStyles } from './ConversationScreen.styles';
import type { parseConversationReport } from './conversationReportTemplate';

/** Render only explicit sections from a validated projection or parser. This is not
 * clinical validation; callers still own final-result and source validation. */
export function ConversationReportText({
  report,
  testID,
  showTitle = true,
  paragraphTestIDPrefix,
  selectable = true,
}: {
  readonly report: NonNullable<ReturnType<typeof parseConversationReport>>;
  readonly testID?: string;
  /** Keep Records' paragraph selectors attached to the real selectable body. */
  readonly paragraphTestIDPrefix?: string;
  /** The Records shell already has the same report title above its metadata. */
  readonly showTitle?: boolean;
  readonly selectable?: boolean;
}) {
  return (
    <View testID={testID} style={styles.report}>
      {showTitle ? (
        <AppText
          accessibilityRole="header"
          selectable={selectable}
          style={[conversationStyles.messageText, styles.title]}
        >
          {report.title}
        </AppText>
      ) : null}
      {report.introduction !== undefined ? (
        <AppText selectable={selectable} style={conversationStyles.messageText}>
          {report.introduction}
        </AppText>
      ) : null}
      {report.sections.map((section, index) => (
        <ConversationReportSection key={index} title={section.title}>
          <AppText
            selectable={selectable}
            testID={
              paragraphTestIDPrefix
                ? `${paragraphTestIDPrefix}-${index}`
                : undefined
            }
            style={conversationStyles.messageText}
          >
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
