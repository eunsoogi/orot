import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import type { ConversationA2UINode } from './conversationA2UI';

/** The caller supplies only the parser's verified tree, not wire messages.
 * No catalog values are spread into native props or turned into actions. */
export function ConversationA2UISurface({
  root,
  testID,
}: {
  readonly root: ConversationA2UINode;
  readonly testID?: string;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <View testID={testID} style={styles.surface}>
      <SurfaceNode node={root} fontScale={fontScale} />
    </View>
  );
}

function SurfaceNode({
  node,
  fontScale,
}: {
  readonly node: ConversationA2UINode;
  readonly fontScale: number;
}) {
  if (node.component === 'Text') {
    return (
      <AppText
        allowFontScaling
        style={node.variant === 'caption' ? styles.caption : styles.body}
      >
        {node.text}
      </AppText>
    );
  }
  if (node.component === 'Row')
    return <SurfaceRow nodes={node.children} fontScale={fontScale} />;
  return (
    // A List flows inside the owning conversation scroller; no nested viewport
    // can trap scrolling or hide its child text from assistive technology.
    <View
      testID={node.component === 'List' ? 'conversation-a2ui-list' : undefined}
      style={node.component === 'Card' ? styles.card : styles.stack}
    >
      {node.children.map(child => (
        <SurfaceNode key={child.id} node={child} fontScale={fontScale} />
      ))}
    </View>
  );
}

function SurfaceRow({
  nodes,
  fontScale,
}: {
  readonly nodes: readonly ConversationA2UINode[];
  readonly fontScale: number;
}) {
  const [width, setWidth] = useState(0);
  // Prefer readable stacked order before layout, at larger text sizes, or
  // when nesting leaves too little width for two long, wrapping values.
  const columns = nodes.length === 2 && fontScale < 1.4 && width >= 240;
  return (
    <View
      testID="conversation-a2ui-row"
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={columns ? styles.columns : styles.stack}
    >
      {nodes.map(node => (
        <View key={node.id} style={columns ? styles.column : styles.surface}>
          <SurfaceNode node={node} fontScale={fontScale} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { minWidth: 0 },
  stack: { gap: 8, minWidth: 0 },
  card: {
    padding: 12,
    borderRadius: 12,
    gap: 8,
    minWidth: 0,
    backgroundColor: appColors.primarySoft,
  },
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minWidth: 0,
  },
  column: { flex: 1, minWidth: 0 },
  body: { fontSize: 15, flexShrink: 1 },
  caption: { fontSize: 13, color: appColors.secondary, flexShrink: 1 },
});
