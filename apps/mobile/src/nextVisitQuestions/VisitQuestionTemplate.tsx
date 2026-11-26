import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { t } from '../i18n';
import type { NextVisitQuestionsTheme } from './types';

/** Live edit controls and verified archived question rows share one inline template. */
export function VisitQuestionTemplate({
  theme,
  children,
}: {
  readonly theme: NextVisitQuestionsTheme;
  readonly children: ReactNode;
}) {
  return (
    <View testID="inline-visit-review" style={{ gap: theme.tokens.spacing.sm }}>
      <Text
        accessibilityRole="header"
        style={{
          color: theme.colors.text,
          fontSize: theme.tokens.typography.sizes.heading,
          fontWeight: theme.tokens.typography.weights.bold,
        }}
      >
        {t('visitQuestions.inline.title')}
      </Text>
      {children}
    </View>
  );
}
