import { StyleSheet } from 'react-native';
import { AppText } from '../layout/AppText';
import type { ConversationA2UINode } from './conversationA2UI';
import { conversationA2UIRichText } from './conversationA2UIRichText';

const inlineStyle = StyleSheet.create({
  strong: { fontWeight: '700' },
  emphasis: { fontStyle: 'italic' },
  code: { fontVariant: ['tabular-nums'], fontFamily: 'Menlo' },
});

export function renderA2UIInlineRichText(
  node: Extract<ConversationA2UINode, { component: 'Text' }>,
) {
  const runs = conversationA2UIRichText(node);
  return runs
    ? runs.map((run, index) =>
        run.kind === 'text' || run.kind === 'link' ? (
          run.text
        ) : (
          <AppText key={index} style={inlineStyle[run.kind]}>
            {run.text}
          </AppText>
        ),
      )
    : node.text;
}
