import { StyleSheet } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';

// Match only localized numbers with decimal/grouping punctuation; retain the formatter's original
// string and unit order, including multiple amounts such as hours and minutes.
const amountPart =
  /([+\-−]?\p{Decimal_Number}+(?:[.,\u00a0\u202f\u066b\u066c]\p{Decimal_Number}+)*)/gu;

/** Styles the already-formatted display value without rounding or changing its reading order. */
export function OverviewReadingValue({
  formatted,
}: {
  readonly formatted: string;
}) {
  return formatted.split(amountPart).map((part, index) =>
    !part || index % 2 ? (
      part
    ) : (
      <Text key={index} style={styles.unit}>
        {part}
      </Text>
    ),
  );
}

const styles = StyleSheet.create({
  unit: { color: appColors.secondary, fontSize: 22, fontWeight: '400' },
});
