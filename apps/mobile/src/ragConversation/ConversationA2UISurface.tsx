import { isFinalConversationCaption } from './conversationA2UICaptionTask';
import { ConversationA2UITabs } from './ConversationA2UITabs';
import {
  ConversationA2UIModal,
  ConversationA2UIModalAdmission,
  ConversationA2UIModalRoot,
} from './ConversationA2UIModal';
import { createConversationA2UIModalArbiter } from './conversationA2UIModalArbiter';
import { conversationA2UIModalFor } from './conversationA2UIModalWire';
import { useCallback, useContext, useMemo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { ConversationA2UIHorizontalList } from './ConversationA2UIHorizontalList';
import { AppText } from '../layout/AppText';
import { renderA2UIInlineRichText } from './ConversationA2UIInlineRichText';
import { AppSymbol } from '../layout/AppSymbol';
import { a2uiSurfaceStyles as styles } from './conversationA2UISurfaceStyles';
import { appColors } from '../layout/appColors';
import type { ConversationA2UIAlignment } from './conversationA2UIAlignment';
import {
  a2uiNaturalRowChildren,
  a2uiWeightedRow,
  a2uiChildRowWeight,
  a2uiNativeAlignment,
  a2uiStretchedColumnChild,
} from './conversationA2UINativeAlignment';
import { conversationA2UIIcons } from './conversationA2UIStaticCatalog';
import type { ConversationA2UINode } from './conversationA2UI';
import { ConversationA2UILocalDraftControls } from './ConversationA2UILocalDraftControls';
import {
  ConversationA2UILocalDraftOwner,
  useOwnedConversationA2UIStamp,
} from './conversationA2UILocalDraftOwner';
import { conversationA2UILocalDraftFor } from './conversationA2UILocalDraftFrames';

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
  const modalAdmission = useMemo(createConversationA2UIModalArbiter, [root]);
  const owner = useContext(ConversationA2UILocalDraftOwner);
  const draft = conversationA2UILocalDraftFor(root);
  const surface = useOwnedConversationA2UIStamp(owner, root, !!draft);
  const isCurrent = useCallback(
    () => surface !== undefined && owner?.surface(root) === surface,
    [owner, root, surface],
  );
  return (
    <View testID={testID} style={styles.surface}>
      <ConversationA2UIModalRoot.Provider value={root}>
        <ConversationA2UIModalAdmission.Provider value={modalAdmission}>
          <SurfaceNode key={root.id} node={root} fontScale={fontScale} />
        </ConversationA2UIModalAdmission.Provider>
      </ConversationA2UIModalRoot.Provider>
      {draft && owner && surface ? (
        <ConversationA2UILocalDraftControls
          approved={draft}
          isCurrent={isCurrent}
          subscribe={owner.subscribe}
          surfaceId={surface}
        />
      ) : null}
    </View>
  );
}

function SurfaceNode({
  node,
  fontScale,
  horizontal = false,
}: {
  readonly horizontal?: boolean;
  readonly node: ConversationA2UINode;
  readonly fontScale: number;
}) {
  const modal = conversationA2UIModalFor(node);
  if (modal)
    return (
      <ConversationA2UIModal
        trigger={<SurfaceNode node={modal.children[0]} fontScale={fontScale} />}
        panel={<SurfaceNode node={modal.children[1]} fontScale={fontScale} />}
      />
    );
  if (node.component === 'Divider') {
    return (
      <View
        testID="conversation-a2ui-divider"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={
          node.axis === 'vertical' && horizontal
            ? styles.verticalDivider
            : styles.divider
        }
      />
    );
  }
  if (node.component === 'Icon') {
    return (
      <AppSymbol
        name={conversationA2UIIcons[node.name]}
        color={appColors.secondary}
      />
    );
  }
  if (node.component === 'Tabs') {
    return (
      <ConversationA2UITabs
        tabs={node.tabs}
        renderChild={child => (
          <SurfaceNode node={child} fontScale={fontScale} />
        )}
      />
    );
  }
  if (node.component === 'Text') {
    return (
      <AppText
        allowFontScaling
        style={
          node.variant === 'caption' || isFinalConversationCaption(node)
            ? styles.caption
            : styles.body
        }
      >
        {renderA2UIInlineRichText(node)}
      </AppText>
    );
  }
  if (node.component === 'List' && node.direction === 'horizontal')
    return (
      <ConversationA2UIHorizontalList
        fontScale={fontScale}
        children={node.children.map(child => ({
          id: child.id,
          content: <SurfaceNode node={child} fontScale={fontScale} />,
        }))}
      />
    );
  if (node.component === 'Row')
    return (
      <SurfaceRow
        nodes={node.children}
        fontScale={fontScale}
        alignment={node.alignment}
      />
    );
  return (
    <View
      testID={
        node.component === 'Column' || node.component === 'List'
          ? `conversation-a2ui-${node.component.toLowerCase()}`
          : undefined
      }
      style={
        node.component === 'Card'
          ? styles.card
          : [styles.stack, a2uiNativeAlignment(node.alignment)]
      }
    >
      {node.children.map(child =>
        node.alignment?.justify === 'stretch' ? (
          <View key={child.id} style={a2uiStretchedColumnChild}>
            <SurfaceNode node={child} fontScale={fontScale} />
          </View>
        ) : (
          <SurfaceNode key={child.id} node={child} fontScale={fontScale} />
        ),
      )}
    </View>
  );
}

function SurfaceRow({
  nodes,
  fontScale,
  alignment,
}: {
  readonly alignment?: ConversationA2UIAlignment;
  readonly nodes: readonly ConversationA2UINode[];
  readonly fontScale: number;
}) {
  const [width, setWidth] = useState(0);
  // Prefer readable stacked order before layout, at larger text sizes, or
  // when nesting leaves too little width for two long, wrapping values.
  const contentCount = nodes.filter(
    node => node.component !== 'Divider',
  ).length;
  const weightedMinWidth = a2uiWeightedRow(nodes);
  const columns =
    contentCount >= 2 &&
    fontScale < 1.4 &&
    width >= (weightedMinWidth ?? contentCount * 120) &&
    nodes.every(
      node => node.component !== 'Divider' || node.axis === 'vertical',
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
        columns && node.component === 'Divider' ? (
          <SurfaceNode
            key={node.id}
            node={node}
            fontScale={fontScale}
            horizontal
          />
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
            <SurfaceNode node={node} fontScale={fontScale} />
          </View>
        ),
      )}
    </View>
  );
}
