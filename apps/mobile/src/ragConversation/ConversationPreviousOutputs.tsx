import { View } from 'react-native';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';

/** Keep superseded raw text visually distinct from the validated successor answer. */
export function ConversationPreviousOutputs({
  outputs,
}: {
  outputs?: readonly string[];
}) {
  if (!outputs?.length) return null;
  return (
    <View testID="conversation-previous-outputs">
      <AppText style={styles.activity}>
        {t('conversationPreviousOutputs.notice')}
      </AppText>
      {outputs.map((text, index) => (
        <AppText key={index}>{text}</AppText>
      ))}
    </View>
  );
}
