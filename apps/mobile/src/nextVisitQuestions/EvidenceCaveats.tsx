import { useState } from 'react';
import { t } from '../i18n';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { evidenceCaveatCopy } from './copy';
import { createNextVisitStyles } from './styles';
import type { EvidenceCaveat, NextVisitQuestionsTheme } from './types';

/** Preserves evidence limits, with quieter disclosure for completed inline results. */
export function EvidenceCaveats({
  caveats,
  theme,
  collapsed = false,
}: {
  readonly collapsed?: boolean;
  readonly caveats: readonly EvidenceCaveat[];
  readonly theme: NextVisitQuestionsTheme;
}) {
  const [open, setOpen] = useState(false);
  const styles = createNextVisitStyles(theme);
  if (caveats.length === 0) return null;
  // Completed-result limitations are secondary details, never a substitute for actual errors.
  if (collapsed)
    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(value => !value)}
          style={[
            detailStyles.toggle,
            { minHeight: theme.tokens.minTouchTarget },
          ]}
          testID="inline-visit-generation-details"
        >
          <Text style={{ color: theme.colors.textMuted }}>
            {t('visitQuestions.inline.generationDetails')}
          </Text>
        </Pressable>
        {open
          ? [...new Set(caveats)].map(caveat => (
              <Text
                key={caveat}
                style={{ color: theme.colors.textMuted }}
                testID={`next-visit-caveat-${caveat}`}
              >
                {evidenceCaveatCopy[caveat]}
              </Text>
            ))
          : null}
      </View>
    );
  return (
    <View style={styles.caveatBox} testID="next-visit-caveats">
      <AppSymbol
        name="exclamationmark.circle.fill"
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

const detailStyles = StyleSheet.create({
  toggle: { justifyContent: 'center' },
});
