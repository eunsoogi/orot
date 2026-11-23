import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { RecordsHubBanner, RecordsHubHeadingContext } from './RecordsHubBanner';
import { sectionTabStyles as tabs } from '../layout/sectionTabPresentation';
import { appColors } from '../layout/appColors';
import { hubSpacing } from '../layout/hubSpacing';
import { t } from '../i18n';
import { settleNavigationRequest } from '../navigation/nativeNavigationActions';
import { NavigationInlineTransition } from '../navigation/NavigationInlineTransition';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';

const RecordsDetailVisibilityContext = createContext<
  ((visible: boolean) => void) | null
>(null);

/** Inline compatibility details hide root chrome and restore it on Back or unmount. */
export function useRecordsDetailVisibility(visible: boolean) {
  const setVisible = useContext(RecordsDetailVisibilityContext);
  useLayoutEffect(() => {
    setVisible?.(visible);
    return () => setVisible?.(false);
  }, [setVisible, visible]);
}

type RecordsSection = 'records' | 'schedule';

/** Keeps schedule in Records without merging their independent data and scroll owners. */
export function RecordsHubSection({
  selected,
  onSelect,
  children,
}: {
  readonly selected: RecordsSection;
  readonly onSelect?: (section: RecordsSection) => Promise<void>;
  readonly children: ReactNode;
}) {
  const [detailVisible, setDetailVisible] = useState(false);
  const [pending, setPending] = useState(false);
  async function select(section: RecordsSection) {
    if (!onSelect || pending || section === selected) return;
    setPending(true);
    try {
      await onSelect(section);
    } finally {
      setPending(false);
    }
  }
  const header = (
    <View style={styles.header} testID="records-hub-header">
      <RecordsHubBanner />
      <View
        style={[tabs.tabs, styles.tabsMargin]}
        testID="records-section-tabs"
      >
        {(['records', 'schedule'] as const).map(section => (
          <Pressable
            key={section}
            accessibilityRole="button"
            accessibilityLabel={t(`navigation.tabs.${section}`)}
            testID={`records-section-${section}`}
            accessibilityState={{
              selected: selected === section,
              disabled: pending || !onSelect,
            }}
            disabled={pending || !onSelect}
            onPress={() => {
              settleNavigationRequest(select(section));
            }}
            style={[tabs.tab, selected === section && tabs.selectedTab]}
          >
            <Text
              style={[tabs.label, selected === section && tabs.selectedLabel]}
            >
              {t(`navigation.tabs.${section}`)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
  return (
    <View style={styles.screen}>
      <NavigationRouteScrollView
        testID={
          selected === 'schedule'
            ? 'calendar-screen'
            : 'navigation-route-scroll'
        }
      >
        {selected === 'schedule' || !detailVisible ? header : null}
        <RecordsHubHeadingContext.Provider value>
          <RecordsDetailVisibilityContext.Provider value={setDetailVisible}>
            <View style={styles.viewport} testID="records-hub-body">
              <NavigationInlineTransition
                transitionKey={selected}
                depth={selected === 'records' ? 0 : 1}
                style={styles.body}
              >
                {children}
              </NavigationInlineTransition>
            </View>
          </RecordsDetailVisibilityContext.Provider>
        </RecordsHubHeadingContext.Provider>
      </NavigationRouteScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, backgroundColor: appColors.background },
  viewport: { flexGrow: 1, minWidth: 0, overflow: 'hidden' },
  body: { flexGrow: 1, minWidth: 0 },
  header: {
    marginHorizontal: hubSpacing.horizontal,
    marginTop: hubSpacing.top,
    borderRadius: 24,
    borderWidth: 0,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
    overflow: 'hidden',
  },
  tabsMargin: { margin: 16, marginTop: 0 },
});
