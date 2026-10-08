import { Button, StyleSheet, View } from 'react-native';
import { AiFeatureFlow } from './AiFeatureFlow';
import { openEuropePmcArticle } from './articleLinks';
import SafeAreaLayout from '../../layout/SafeAreaLayout';
import { t } from '../../i18n';

interface AiFeatureRouteProps {
  readonly onBack: () => void;
}

/** Owns the safe-area shell and app-level exit while feature screens own their inner navigation. */
export function AiFeatureRoute({ onBack }: AiFeatureRouteProps) {
  return (
    <SafeAreaLayout scrollable={false}>
      <View style={styles.container}>
        <Button
          onPress={onBack}
          testID="ai-feature-back"
          title={t('aiFeatures.back')}
        />
        <AiFeatureFlow onOpenArticle={openEuropePmcArticle} />
      </View>
    </SafeAreaLayout>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
