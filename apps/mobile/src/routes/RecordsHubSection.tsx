import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
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
      <View style={styles.tabs} testID="records-section-tabs">
        {(['records', 'schedule'] as const).map(section => (
          <AppButton
            key={section}
            title={t(`navigation.tabs.${section}`)}
            testID={`records-section-${section}`}
            accessibilityState={{ selected: selected === section }}
            variant={selected === section ? 'neutral' : 'text'}
            disabled={pending || !onSelect}
            onPress={() => {
              settleNavigationRequest(select(section));
            }}
            style={styles.tab}
          />
        ))}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, backgroundColor: appColors.background },
  records: { flexGrow: 1, backgroundColor: appColors.background },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: hubSpacing.horizontal,
    paddingTop: hubSpacing.top,
  },
  tab: { flexGrow: 1, flexBasis: 120 },
});
