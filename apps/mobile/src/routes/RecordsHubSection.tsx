import { createContext, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { RecordsHubBanner, RecordsHubHeadingContext } from './RecordsHubBanner';
import { appColors } from '../layout/appColors';
import { hubSpacing } from '../layout/hubSpacing';
import { t } from '../i18n';
import { settleNavigationRequest } from '../navigation/nativeNavigationActions';

// Schedule owns its vertical scroll; hand the same header into that owner.
export const RecordsHubScrollHeaderContext = createContext<ReactNode>(null);

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
  const header = (
    <View style={styles.header} testID="records-hub-header">
      <RecordsHubBanner />
      <View style={styles.tabs} testID="records-section-tabs">
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
            style={[styles.tab, selected === section && styles.selectedTab]}
          >
            <Text
              style={[
                styles.label,
                selected === section && styles.selectedLabel,
              ]}
            >
              {t(`navigation.tabs.${section}`)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
  return (
    <View style={selected === 'schedule' ? styles.screen : styles.records}>
      {selected === 'records' ? header : null}
      <RecordsHubScrollHeaderContext.Provider
        value={selected === 'schedule' ? header : null}
      >
        <RecordsHubHeadingContext.Provider value>
          {children}
        </RecordsHubHeadingContext.Provider>
      </RecordsHubScrollHeaderContext.Provider>
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
  tabs: {
    flexDirection: 'row',
    margin: 16,
    marginTop: 0,
    padding: 3,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.background,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
  },
  selectedTab: { backgroundColor: appColors.text },
  label: {
    color: appColors.secondary,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  selectedLabel: { color: appColors.background },
});
