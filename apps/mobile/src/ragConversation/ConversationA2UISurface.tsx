import { useCallback, useContext, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { a2uiSurfaceStyles as styles } from './conversationA2UISurfaceStyles';
import { appColors } from '../layout/appColors';
import type { ConversationA2UIAlignment } from './conversationA2UIAlignment';
import {
  a2uiNaturalRowChildren,
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
  const owner = useContext(ConversationA2UILocalDraftOwner);
  const draft = conversationA2UILocalDraftFor(root);
  const surface = useOwnedConversationA2UIStamp(owner, root, !!draft);
  const isCurrent = useCallback(
    () => surface !== undefined && owner?.surface(root) === surface,
    [owner, root, surface],
  );
  return (
    <View testID={testID} style={styles.surface}>
      <SurfaceNode key={root.id} node={root} fontScale={fontScale} />
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
    return <SurfaceTabs tabs={node.tabs} fontScale={fontScale} />;
  }
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
    return (
      <SurfaceRow
        nodes={node.children}
        fontScale={fontScale}
        alignment={node.alignment}
      />
    );
  return (
    // A List flows inside the owning conversation scroller; no nested viewport
    // can trap scrolling or hide its child text from assistive technology.
    <View
      testID={
        node.component === 'Column' ? 'conversation-a2ui-column' : undefined
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
  const columns =
    contentCount >= 2 &&
    fontScale < 1.4 &&
    width >= contentCount * 120 &&
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
                ? a2uiNaturalRowChildren(alignment)
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

function SurfaceTabs({
  tabs,
  fontScale,
}: {
  readonly tabs: Extract<ConversationA2UINode, { component: 'Tabs' }>['tabs'];
  readonly fontScale: number;
}) {
  const [selection, setSelection] = useState<string | undefined>(undefined);
  const selected = tabs.find(tab => tab.child.id === selection) ?? tabs[0];
  if (!selected) return null;
  // Selection changes only local presentation. No callback leaves this surface.
  return (
    <View style={styles.stack}>
      <View accessibilityRole="tablist" style={styles.tabList}>
        {tabs.map(tab => (
          <Pressable
            key={tab.child.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === selected }}
            onPress={() => setSelection(tab.child.id)}
            style={
              tab === selected ? [styles.tab, styles.selectedTab] : styles.tab
            }
          >
            <AppText allowFontScaling>{tab.title}</AppText>
          </Pressable>
        ))}
      </View>
      <SurfaceNode
        key={selected.child.id}
        node={selected.child}
        fontScale={fontScale}
      />
    </View>
  );
}
