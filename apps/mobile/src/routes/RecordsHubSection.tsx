import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { RecordsHubBanner, RecordsHubHeadingContext } from './RecordsHubBanner';
import { sectionTabStyles as tabs } from '../layout/sectionTabPresentation';
import { appColors } from '../layout/appColors';
import { hubSpacing } from '../layout/hubSpacing';
import { t } from '../i18n';
import { settleNavigationRequest } from '../navigation/nativeNavigationActions';

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
  return (
    <View style={selected === 'schedule' ? styles.screen : styles.records}>
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
      <RecordsHubHeadingContext.Provider value>
        {children}
      </RecordsHubHeadingContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, backgroundColor: appColors.background },
  records: { flexGrow: 1, backgroundColor: appColors.background },
  header: {
    marginHorizontal: hubSpacing.horizontal,
    marginTop: hubSpacing.top,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
    overflow: 'hidden',
  },
  tabsMargin: { margin: 16, marginTop: 0 },
});
