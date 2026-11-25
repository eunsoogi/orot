import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from '../layout/AppText';
import type { ConversationA2UINode } from './conversationA2UI';
import { a2uiSurfaceStyles as styles } from './conversationA2UISurfaceStyles';

export function ConversationA2UITabs({
  tabs,
  renderChild,
}: {
  readonly tabs: Extract<ConversationA2UINode, { component: 'Tabs' }>['tabs'];
  readonly renderChild: (node: ConversationA2UINode) => ReactNode;
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
      <Fragment key={selected.child.id}>{renderChild(selected.child)}</Fragment>
    </View>
  );
}
