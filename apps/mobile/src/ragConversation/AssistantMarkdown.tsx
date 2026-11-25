import { Linking, StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import type { MarkdownBlock } from './conversationMarkdown';
import type { MarkdownRun } from './conversationMarkdownInline';
import { styles as conversation } from './ConversationScreen.styles';

interface Props {
  readonly blocks: readonly MarkdownBlock[];
  readonly testID?: string;
  readonly selectable: boolean;
  readonly onLinkError?: () => void;
}

const textStyle = StyleSheet.create({
  body: { gap: 8, minWidth: 0 },
  heading: { fontSize: 18, lineHeight: 27, fontWeight: '700' },
  strong: { fontWeight: '700' },
  emphasis: { fontStyle: 'italic' },
  code: { fontFamily: 'Menlo', backgroundColor: appColors.background },
  codeBlock: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  link: { color: appColors.primaryText, textDecorationLine: 'underline' },
});

/** Native text only: Markdown stays scoped to the bubble, with no HTML or media host. */
export function AssistantMarkdown({
  blocks,
  testID,
  selectable,
  onLinkError,
}: Props) {
  return (
    <View style={textStyle.body} testID={testID}>
      {blocks.map((block, index) =>
        block.kind === 'code' ? (
          <AppText
            key={index}
            selectable={selectable}
            style={[
              conversation.messageText,
              textStyle.code,
              textStyle.codeBlock,
            ]}
          >
            {block.text}
          </AppText>
        ) : (
          <AppText
            key={index}
            selectable={selectable}
            accessibilityRole={block.kind === 'heading' ? 'header' : undefined}
            style={[
              conversation.messageText,
              block.kind === 'heading' && textStyle.heading,
            ]}
          >
            {block.kind === 'item' ? block.marker + ' ' : null}
            {block.runs.map((run, runIndex) => (
              <MarkdownInline
                key={runIndex}
                run={run}
                onLinkError={onLinkError}
              />
            ))}
          </AppText>
        ),
      )}
    </View>
  );
}

function MarkdownInline({
  run,
  onLinkError,
}: {
  readonly run: MarkdownRun;
  readonly onLinkError?: () => void;
}) {
  if (run.kind === 'text') return run.text;
  if (run.kind === 'link' && run.url) {
    const url = run.url;
    // Only an explicit tap hands the validated URL to the same OS link opener
    // used for public source links. A Markdown link is not a source citation.
    return (
      <AppText
        accessibilityRole="link"
        style={textStyle.link}
        onPress={() => {
          Linking.openURL(url).catch(() => onLinkError?.());
        }}
      >
        {run.text}
      </AppText>
    );
  }
  return (
    <AppText style={run.kind === 'link' ? undefined : textStyle[run.kind]}>
      {run.text}
    </AppText>
  );
}
