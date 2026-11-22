import { View } from 'react-native';
import { AppText } from '../../layout/AppText';
import { disclosureStyles as styles } from './InferenceDisclosureStyles';

/** Settings copy already uses line breaks between whole disclosures. Keep them
 * in reading order and let native text wrap and scale each independently. */
export function InferenceDisclosureScopeText({
  information,
}: {
  readonly information: string;
}) {
  return (
    <View style={styles.scopeParagraphs} testID="inference-disclosure-scope">
      {information.split('\n').map((paragraph, index) => (
        <AppText
          key={`${index}:${paragraph}`}
          style={styles.value}
          testID="inference-disclosure-paragraph"
        >
          {paragraph}
        </AppText>
      ))}
    </View>
  );
}
