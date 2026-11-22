import { NavigationEdgeMenuScrollView } from '../navigation/NavigationEdgeMenuScrollView';
import { Pressable, StyleSheet } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { healthRecordCategoryPresentation } from './healthRecordCategoryPresentation';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { HealthRecordCategory } from './healthRecordsLibraryModel';
import {
  healthRecordCategories,
  healthRecordCategoryTitle,
} from './healthRecordsLibraryModel';

export type HealthRecordFilter = 'all' | HealthRecordCategory;

/** Uses compact 44-point category targets and keeps overflow horizontally scrollable. */
export function HealthRecordsCategoryFilter({
  selected,
  onSelect,
  rightBleed = 0,
  touchClearance = 0,
}: {
  readonly rightBleed?: number;
  readonly touchClearance?: number;
  readonly selected: HealthRecordFilter;
  readonly onSelect: (category: HealthRecordFilter) => void;
}) {
  const options: readonly HealthRecordFilter[] = [
    'all',
    ...healthRecordCategories(),
  ];
  return (
    <NavigationEdgeMenuScrollView
      contentContainerStyle={styles.content}
      rightBleed={rightBleed}
      touchClearance={touchClearance}
      showsHorizontalScrollIndicator={false}
      testID="health-record-category-filter"
    >
      {options.map(category => {
        const title =
          category === 'all'
            ? t('healthRecords.category.all')
            : healthRecordCategoryTitle(category);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: selected === category }}
            key={category}
            onPress={() => onSelect(category)}
            style={[styles.chip, selected === category && styles.selected]}
            testID={'health-record-filter-' + category}
          >
            {category !== 'all' ? (
              <AppSymbol
                name={healthRecordCategoryPresentation[category].symbol}
                size={18}
                color={
                  selected === category
                    ? appColors.onPrimary
                    : appColors.primaryText
                }
              />
            ) : null}
            <Text
              style={[
                styles.label,
                selected === category && styles.selectedLabel,
              ]}
            >
              {title}
            </Text>
          </Pressable>
        );
      })}
    </NavigationEdgeMenuScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 6, paddingVertical: 2 },
  chip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 10,
  },
  selected: {
    backgroundColor: appColors.primaryAction,
    borderColor: appColors.primaryAction,
  },
  label: { color: appColors.text, fontSize: 14, fontWeight: '500' },
  selectedLabel: { color: appColors.onPrimary, fontWeight: '700' },
});
