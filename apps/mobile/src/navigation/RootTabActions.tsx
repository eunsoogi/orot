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

/** Routes tab changes through the current screen's leave guard before selection. */
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
          style={styles.tab}
          testID={item.testID}
        >
          <Text
            style={[
              styles.symbol,
              rootTabs.activeTab === item.id && styles.selected,
            ]}
          >
            {item.fallbackSymbol}
          </Text>
          <Text
            style={[
              styles.label,
              rootTabs.activeTab === item.id && styles.selected,
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
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 44,
  },
  symbol: { color: appColors.secondary, fontSize: 21, lineHeight: 24 },
  label: { color: appColors.secondary, fontSize: 10, lineHeight: 13 },
  selected: { color: appColors.primary },
});
