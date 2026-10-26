import { Text, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { evidenceCaveatCopy } from './copy';
import { createNextVisitStyles } from './styles';
import type { EvidenceCaveat, NextVisitQuestionsTheme } from './types';

/** Keeps evidence limits visible wherever a generated question is being reviewed. */
export function EvidenceCaveats({
  caveats,
  theme,
}: {
  readonly caveats: readonly EvidenceCaveat[];
  readonly theme: NextVisitQuestionsTheme;
}) {
  const styles = createNextVisitStyles(theme);
  if (caveats.length === 0) return null;
  return (
    <View style={styles.caveatBox} testID="next-visit-caveats">
      <AppSymbol
        name="exclamationmark.circle.fill"
        size={20}
        color={theme.colors.warning}
      />
      <View style={styles.caveatContent}>
        {[...new Set(caveats)].map(caveat => (
          <Text
            accessibilityRole="text"
            key={caveat}
            style={styles.caveatText}
            testID={`next-visit-caveat-${caveat}`}
          >
            {evidenceCaveatCopy[caveat]}
          </Text>
        ))}
      </View>
    </View>
  );
}
