import { StyleSheet, View } from 'react-native';
import { appColors } from '../../layout/appColors';
import { PulsingSkeleton } from '../../layout/PulsingSkeleton';

/** Represents only pending values; callers continue to render their existing data or error states. */
export function OverviewReadingSkeleton({
  metric,
  large,
  label,
}: {
  readonly metric: string;
  readonly large?: boolean;
  readonly label?: string;
}) {
  return (
    <View
      accessible={Boolean(label)}
      accessibilityLabel={label}
      accessibilityRole={label ? 'status' : undefined}
    >
      <PulsingSkeleton testID={`overview-widget-skeleton-${metric}`}>
        <View style={[styles.bar, large && styles.large]} />
      </PulsingSkeleton>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    width: 54,
    height: 15,
    borderRadius: 6,
    backgroundColor: appColors.border,
  },
  large: { width: 100, height: 24, marginVertical: 7 },
});
