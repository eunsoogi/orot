import { Pressable, StyleSheet, Text } from 'react-native';
import type { NavigationController } from './navigationController';
import type { NavigationRootTabs } from './rootTabs';
import { rootTabItems } from './rootTabs';
import { appColors } from '../layout/appColors';
import { settleNavigationRequest } from './nativeNavigationActions';

interface RootTabActionsProps<Name extends string> {
  readonly controller: NavigationController<Name>;
  readonly disabled: boolean;
  readonly rootTabs: NavigationRootTabs;
}

/** Routes tab changes through leave guards and keeps selection visible without color alone. */
export function RootTabActions<Name extends string>({
  controller,
  disabled,
  rootTabs,
}: RootTabActionsProps<Name>) {
  return (
    <>
      {rootTabItems.map(item => (
        <Pressable
          accessibilityLabel={item.accessibilityLabel}
          accessibilityRole="button"
          accessibilityState={{
            selected: rootTabs.activeTab === item.id,
            disabled,
          }}
          disabled={disabled}
          key={item.id}
          onPress={() => {
            if (rootTabs.activeTab === item.id) return;
            settleNavigationRequest(
              controller
                .requestTabSwitch()
                .then(allowed =>
                  allowed ? rootTabs.onSelect(item.id) : undefined,
                ),
            );
          }}
          style={[
            styles.tab,
            rootTabs.activeTab === item.id && styles.selectedTab,
          ]}
          testID={item.testID}
        >
          <Text
            style={[
              styles.symbol,
              rootTabs.activeTab === item.id && styles.selectedForeground,
            ]}
          >
            {item.fallbackSymbol}
          </Text>
          <Text
            style={[
              styles.label,
              rootTabs.activeTab === item.id && styles.selectedForeground,
            ]}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  tab: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 24,
    gap: 2,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 44,
    paddingHorizontal: 6,
  },
  selectedTab: { backgroundColor: appColors.primaryAction },
  symbol: { color: appColors.secondary, fontSize: 22, lineHeight: 24 },
  label: { color: appColors.secondary, fontSize: 12, lineHeight: 16 },
  selectedForeground: { color: appColors.onPrimary },
});
