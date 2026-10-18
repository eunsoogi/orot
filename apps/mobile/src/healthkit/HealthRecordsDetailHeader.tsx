import { AppSymbol } from '../layout/AppSymbol';
import { healthRecordCategoryPresentation } from './healthRecordCategoryPresentation';
import { healthRecordCategoryTitle } from './healthRecordsLibraryModel';
import { Pressable, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { navigationText } from '../i18n/navigation';
import type { HealthRecordsDetailSelection } from './healthRecordsLibraryModel';
import { healthRecordPeriodTitle } from './healthRecordsLibraryModel';
import { healthRecordPeriods } from './healthRecordsDetailModel';
import { healthRecordsDetailStyles as styles } from './HealthRecordsDetailScreen.styles';

/** Shows period selection and honest loaded counts while unbounded history remains paged. */
export function HealthRecordsDetailHeader({
  title,
  hasSharedNavigation,
  onBack,
  selection,
  onSelectionChange,
  recordCount,
  observationCount,
  loadState,
  onRetry,
  hasMore,
}: {
  readonly title: string;
  readonly hasSharedNavigation: boolean;
  readonly onBack: () => void;
  readonly selection: HealthRecordsDetailSelection;
  readonly onSelectionChange: (selection: HealthRecordsDetailSelection) => void;
  readonly recordCount: number;
  readonly observationCount: number;
  readonly loadState: 'loading' | 'ready' | 'failed';
  readonly onRetry: () => void;
  readonly hasMore: boolean;
}) {
  const appearance = healthRecordCategoryPresentation[selection.category];
  return (
    <View style={styles.header}>
      <View style={styles.topBar}>
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="health-records-detail-title"
        >
          {title}
        </Text>
        {hasSharedNavigation ? null : (
          <AppButton
            accessibilityLabel={navigationText.back.accessibilityLabel}
            onPress={onBack}
            testID="health-records-detail-back"
            title={navigationText.back.label}
            variant="secondary"
          />
        )}
      </View>
      <Text style={styles.description}>
        {t('healthRecords.detailDescription')}
      </Text>
      <View accessibilityRole="radiogroup" style={styles.periods}>
        {healthRecordPeriods.map(period => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: selection.period === period }}
            key={period}
            onPress={() => onSelectionChange({ ...selection, period })}
            style={[
              styles.period,
              selection.period === period && styles.selectedPeriod,
            ]}
            testID={'health-record-period-' + period}
          >
            <Text
              style={[
                styles.periodText,
                selection.period === period && styles.selectedPeriodText,
              ]}
            >
              {healthRecordPeriodTitle(period)}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.summaryCard}>
        <View
          style={[
            styles.summaryIcon,
            { backgroundColor: appearance.background },
          ]}
        >
          <AppSymbol
            name={appearance.symbol}
            color={appearance.color}
            size={26}
          />
        </View>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryTitle}>
            {healthRecordCategoryTitle(selection.category) + ' 기록'}
          </Text>
          <Text style={styles.count}>
            {t(
              hasMore
                ? 'healthRecords.loadedRecordCount'
                : 'healthRecords.recordCount',
              { count: recordCount },
            )}
          </Text>
        </View>
      </View>
      {loadState === 'loading' && observationCount === 0 ? (
        <Text testID="health-records-detail-loading">
          {t('healthRecords.loading')}
        </Text>
      ) : null}
      {loadState === 'failed' && observationCount === 0 ? (
        <View>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('healthRecords.error')}
          </Text>
          <AppButton
            onPress={onRetry}
            testID="health-records-detail-retry"
            title={t('healthRecords.retry')}
            variant="secondary"
          />
        </View>
      ) : null}
    </View>
  );
}
