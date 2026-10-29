import { View } from 'react-native';
import { AdaptiveColumns, type AdaptiveColumnsProps } from './AdaptiveColumns';

/** Keep page sections in reading order while retaining the measured usable region. */
export function VerticalPageSections({
  primary,
  secondary,
  testID = 'vertical-page-sections',
  ...frameProps
}: AdaptiveColumnsProps) {
  return (
    <AdaptiveColumns
      {...frameProps}
      testID={`${testID}-frame`}
      primary={
        <View style={{ flexDirection: 'column', gap: 20 }} testID={testID}>
          <View testID={`${testID}-primary`}>{primary}</View>
          {secondary != null ? (
            <View testID={`${testID}-secondary`}>{secondary}</View>
          ) : null}
        </View>
      }
    />
  );
}
