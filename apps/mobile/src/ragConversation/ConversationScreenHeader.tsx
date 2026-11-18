import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { ConversationBackButton } from './ConversationBackButton';
import { styles } from './ConversationScreen.styles';

/** Keep navigation and model selection separate from the current transcript. */
export function ConversationScreenHeader({
  routeKey,
  onBack,
  provider,
  notice,
}: {
  readonly routeKey?: string;
  readonly onBack: () => void;
  readonly provider?: ReactNode;
  readonly notice: string;
}) {
  return (
    <View style={styles.header}>
      {!routeKey && <ConversationBackButton onBack={onBack} />}
      {provider ? <View style={styles.provider}>{provider}</View> : null}
      <Text style={styles.disclaimer}>{notice}</Text>
    </View>
  );
}
