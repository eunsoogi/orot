import { View } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import type { AppleDerivedHeartRateCategory } from '@orot/storage';
import {
  classifyAppleDerivedHeartRate,
  localQueryTimestampKey,
} from '@orot/storage';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import { provenanceLabel } from './healthRecordsDetailPresentation';

/** Summarizes exactly the local Apple metric in the admitted page, not raw BPM.
 * Keep the per-category mean unofficial: it averages stored Apple measurements,
 * not time, and a cursor means the requested period has more measurements.
 */
export function AppleDerivedHeartRateSummary({
  category,
  observations,
  partial,
}: {
  readonly category: AppleDerivedHeartRateCategory;
  readonly observations: readonly HealthObservation[];
  readonly partial: boolean;
}) {
  let samples = 0;
  let mean = 0;
  let first = '';
  let last = '';
  let firstKey = '';
  let lastKey = '';
  const sources = new Set<string>();
  for (const observation of observations) {
    if (classifyAppleDerivedHeartRate(observation) !== category) continue;
    if (
      observation.value.kind !== 'quantity' ||
      !Number.isFinite(observation.value.amount)
    )
      continue;
    const { effectiveAt } = observation;
    const key = localQueryTimestampKey(effectiveAt);
    if (!firstKey || key < firstKey) {
      first = effectiveAt;
      firstKey = key;
    }
    if (!lastKey || key > lastKey) {
      last = effectiveAt;
      lastKey = key;
    }
    samples += 1;
    mean += (observation.value.amount - mean) / samples;
    sources.add(provenanceLabel(observation));
  }
  if (!samples) return null; // The shared card presents missing separately.
  const displayMean = new Intl.NumberFormat('ko-KR', {
    maximumFractionDigits: 2,
  }).format(mean);
  return (
    <View testID={'health-record-derived-heart-' + category}>
      <Text>
        {t('healthkit.commonObservations.derivedHeartRateMean', {
          mean: displayMean,
          samples,
        })}
      </Text>
      <Text>
        {t('healthkit.commonObservations.derivedHeartRateDates', {
          start: formatRecordedAt(first),
          end: formatRecordedAt(last),
        })}
      </Text>
      <Text>
        {t('healthkit.commonObservations.derivedHeartRateSources', {
          sources: [...sources].join(', '),
        })}
      </Text>
      {partial ? <Text>{t('healthRecords.moreAvailable')}</Text> : null}
    </View>
  );
}
