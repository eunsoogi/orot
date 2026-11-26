import { Fragment, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { ConversationA2UINode } from './conversationA2UI';
import type { ConversationA2UIAlignment } from './conversationA2UIAlignment';
import { conversationA2UIComposedControl } from './conversationA2UIComposedControlState';
import {
  a2uiNaturalRowChildren,
  a2uiWeightedRow,
  a2uiChildRowWeight,
  a2uiNativeAlignment,
} from './conversationA2UINativeAlignment';
import { a2uiSurfaceStyles as styles } from './conversationA2UISurfaceStyles';

export function ConversationA2UISurfaceRow({
  nodes,
  fontScale,
  alignment,
  renderChild,
}: {
  readonly alignment?: ConversationA2UIAlignment;
  readonly nodes: readonly ConversationA2UINode[];
  readonly fontScale: number;
  readonly renderChild: (
    node: ConversationA2UINode,
    horizontal?: boolean,
  ) => ReactNode;
}) {
  const [width, setWidth] = useState(0);
  // Prefer readable stacked order before layout, at larger text sizes, or
  // when nesting leaves too little width for two long, wrapping values.
  const contentCount = nodes.filter(
    node =>
      node.component !== 'Divider' || conversationA2UIComposedControl(node),
  ).length;
  const weightedMinWidth = a2uiWeightedRow(nodes);
  const columns =
    contentCount >= 2 &&
    fontScale < 1.4 &&
    width >= (weightedMinWidth ?? contentCount * 120) &&
    nodes.every(
      node =>
        node.component !== 'Divider' ||
        node.axis === 'vertical' ||
        conversationA2UIComposedControl(node),
    );
  return (
    <View
      testID="conversation-a2ui-row"
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={
        columns
          ? [styles.columns, a2uiNativeAlignment(alignment)]
          : styles.stack
      }
    >
      {nodes.map(node =>
        columns &&
        node.component === 'Divider' &&
        !conversationA2UIComposedControl(node) ? (
          <Fragment key={node.id}>{renderChild(node, true)}</Fragment>
        ) : (
          <View
            key={node.id}
            style={
              columns
                ? weightedMinWidth !== undefined
                  ? [
                      styles.surface,
                      {
                        flexBasis: 0,
                        flexShrink: 1,
                        flexGrow: a2uiChildRowWeight(node),
                      },
                    ]
                  : a2uiNaturalRowChildren(alignment)
                    ? styles.naturalColumn
                    : styles.column
                : styles.surface
            }
          >
            {renderChild(node)}
          </View>
        ),
      )}
    </View>
  );
}
