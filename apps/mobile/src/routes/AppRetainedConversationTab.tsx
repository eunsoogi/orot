import type { NavigationController } from '../navigation/navigationController';
import { useContext, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import { NavigationLeaveStateRegistrationProvider } from '../navigation/useNavigationLeaveStateRegistration';
import { NavigationPrimaryActionContext } from '../navigation/useNavigationPrimaryAction';
import { appRouteIsScrollable } from '../navigation/appContentLayoutPolicy';
import type { AppRootTab } from '../navigation/rootTabs';
import { isAppAiRoute } from './AppConversationScene';
import type { AppNavigationRoute } from './appNavigationRoute';

type RouteActions = NavigationRouteActions<AppNavigationRoute>;
const noLeaveState: RouteActions['registerLeaveState'] = () => () => {};

export function nonRootRouteOwnsScroll(route: RouteActions['route']) {
  return route.name !== 'root' && appRouteIsScrollable(route, 'conversation');
}

/**
 * A sibling tab and an in-progress transition can revoke actions without
 * changing the native route whose transcript remains mounted behind the fade.
 */
export function conversationTabAuthority(
  controller: NavigationController<AppNavigationRoute>,
  route: RouteActions['route'],
  isConversationSelected: () => boolean,
) {
  return {
    isRouteCurrent: () => {
      const snapshot = controller.getSnapshot();
      return (
        snapshot.currentRoute.key === route.key &&
        (route.name === 'root' || !snapshot.isTransitioning)
      );
    },
    isEntryCurrent: () => {
      const snapshot = controller.getSnapshot();
      return (
        !snapshot.isTransitioning &&
        snapshot.currentRoute.key === route.key &&
        (route.name !== 'root' || isConversationSelected())
      );
    },
  };
}

/** Root tabs own their internal scroll wrappers; changing tabs must not remount Chat's native ScrollView. */
export function AppRetainedConversationTab({
  actions,
  activeTab,
  renderConversation,
  children,
}: {
  readonly actions: RouteActions;
  readonly activeTab: AppRootTab;
  readonly renderConversation: (actions: RouteActions) => ReactNode;
  readonly children: ReactNode;
}) {
  const root = actions.route.name === 'root';
  const visible = root && activeTab === 'conversation';
  const [opened, setOpened] = useState(visible);
  useLayoutEffect(() => {
    if (visible && !opened) setOpened(true);
  }, [visible, opened]);
  const primary = useContext(NavigationPrimaryActionContext);
  const conversationActions = useMemo(
    () =>
      !root || visible
        ? actions
        : { ...actions, registerLeaveState: noLeaveState },
    [actions, root, visible],
  );
  if (!root)
    return isAppAiRoute(actions.route.name)
      ? renderConversation(actions)
      : children;
  return (
    <View style={styles.fill}>
      {(visible || opened) && (
        <View
          accessibilityElementsHidden={!visible}
          importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
          pointerEvents={visible ? 'auto' : 'none'}
          style={[styles.conversation, !visible && styles.hidden]}
        >
          <NavigationLeaveStateRegistrationProvider
            registerLeaveState={conversationActions.registerLeaveState}
          >
            <NavigationPrimaryActionContext.Provider
              value={visible ? primary : null}
            >
              {renderConversation(conversationActions)}
            </NavigationPrimaryActionContext.Provider>
          </NavigationLeaveStateRegistrationProvider>
        </View>
      )}
      {!visible &&
        (activeTab !== 'records' &&
        appRouteIsScrollable(actions.route, activeTab) ? (
          <NavigationRouteScrollView key={activeTab}>
            {children}
          </NavigationRouteScrollView>
        ) : (
          children
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Keep the original viewport and native offset measured while another tab covers it.
  conversation: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  hidden: { opacity: 0 },
});
