import { StyleSheet, View } from 'react-native';
import { AdaptiveColumns, type AdaptiveColumnsProps } from './AdaptiveColumns';

export interface VerticalPageSectionsProps extends AdaptiveColumnsProps {
  readonly sectionGap?: number;
}

/** Keeps page sections in reading order in one measured lane with caller-owned spacing. */
export function VerticalPageSections({
  primary,
  secondary,
  sectionGap = 20,
  testID = 'vertical-page-sections',
  ...frameProps
}: VerticalPageSectionsProps) {
  return (
    <AdaptiveColumns
      {...frameProps}
      testID={`${testID}-frame`}
      primary={
        <View style={[styles.sections, { gap: sectionGap }]} testID={testID}>
          <View testID={`${testID}-primary`}>{primary}</View>
          {secondary != null ? (
            <View testID={`${testID}-secondary`}>{secondary}</View>
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  sections: { flexDirection: 'column' },
});
