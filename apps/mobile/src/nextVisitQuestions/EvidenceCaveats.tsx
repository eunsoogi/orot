import { Text } from 'react-native';
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
  return (
    <>
      {[...new Set(caveats)].map(caveat => (
        <Text
          accessibilityRole="text"
          key={caveat}
          style={styles.warning}
          testID={`next-visit-caveat-${caveat}`}
        >
          {evidenceCaveatCopy[caveat]}
        </Text>
      ))}
    </>
  );
}
