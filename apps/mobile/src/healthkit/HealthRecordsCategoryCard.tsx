import {
  HealthRecordsMonthChartPanel,
  type HealthRecordsMonthChartInput,
} from './HealthRecordsMonthChartPanel';
import { StyleSheet, View } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import { HealthRecordsSleepChart } from './HealthRecordsSleepChart';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { healthRecordCategoryPresentation } from './healthRecordCategoryPresentation';
import { HealthRecordsCategoryCharts } from './HealthRecordsCategoryCharts';
import { HealthRecordsCategoryHeading } from './HealthRecordsCategoryHeading';
import type {
  HealthObservationCategory,
  HealthRecordsDetailSelection,
} from './healthRecordsLibraryModel';
import {
  healthRecordCategoryTitle,
  filterObservationsByPeriod,
} from './healthRecordsLibraryModel';

interface HealthRecordsCategoryCardProps {
  readonly category: HealthObservationCategory;
  readonly hasMore?: boolean;
  readonly monthChart?: HealthRecordsMonthChartInput;
  readonly loadState: 'loading' | 'ready' | 'failed';
  readonly observations: readonly HealthObservation[];
  readonly onOpenDetail: (selection: HealthRecordsDetailSelection) => void;
}

/** Keeps bounded charts primary and leaves raw values and provenance in the detail route. */
export function HealthRecordsCategoryCard({
  category,
  hasMore = false,
  loadState,
  observations,
  onOpenDetail,
  monthChart,
}: HealthRecordsCategoryCardProps) {
  const title = healthRecordCategoryTitle(category);
  const appearance = healthRecordCategoryPresentation[category];
  const now = new Date();
  const recentObservations = filterObservationsByPeriod(
    observations,
    'month',
    now.toISOString(),
  );

  return (
    <View style={styles.card} testID={'health-record-category-' + category}>
      <HealthRecordsCategoryHeading
        icon={
          <View
            style={[styles.icon, { backgroundColor: appearance.background }]}
          >
            <AppSymbol name={appearance.symbol} color={appearance.color} />
          </View>
        }
        action={
          <AppButton
            accessibilityHint={t('healthRecords.detailHint', { title })}
            onPress={() => onOpenDetail({ category, period: 'month' })}
            testID={'health-record-open-detail-' + category}
            title={t('healthRecords.detail')}
            variant="secondary"
          />
        }
        body={
          <>
            {recentObservations.length === 0 &&
            (!monthChart || category === 'other') ? (
              <Text
                style={styles.eventSummary}
                testID={'health-record-category-empty-' + category}
              >
                {loadState === 'loading'
                  ? t('healthRecords.loading')
                  : loadState === 'failed'
                    ? t('healthRecords.error')
                    : t(
                        hasMore
                          ? 'healthRecords.categoryNotLoaded'
                          : 'healthRecords.categoryEmpty',
                        { title },
                      )}
              </Text>
            ) : null}
            {monthChart && category !== 'other' ? (
              <HealthRecordsMonthChartPanel
                category={category}
                {...monthChart}
              />
            ) : recentObservations.length > 0 && category === 'sleep' ? (
              <HealthRecordsSleepChart
                observations={recentObservations}
                hasMore={hasMore}
                loadState={loadState}
                now={now}
              />
            ) : recentObservations.length > 0 && category !== 'other' ? (
              <HealthRecordsCategoryCharts
                category={category}
                observations={recentObservations}
                hasMore={hasMore}
                loadState={loadState}
              />
            ) : null}
          </>
        }
      >
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      </HealthRecordsCategoryHeading>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 18,
    // Filled surfaces group saved records; controls and state boundaries stay separate.
    borderWidth: 0,
    gap: 16,
    padding: 16,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: appColors.dangerSurface,
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  title: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  eventSummary: {
    color: appColors.text,
    fontSize: 14,
    lineHeight: 20,
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
  },
});
