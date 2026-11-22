import { StyleSheet, View } from 'react-native';
import { t } from '../../i18n';
import { AppText } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { SelectedModelControl } from '../../layout/SelectedModelControl';
import {
  providerControlCopy,
  type Presentation,
} from './conversationModelControlCopy';

/** The control renders only the presentation selected by the guarded resolver. */
export function ConversationModelSelectorControl({
  shown,
  onPress,
  embedded,
}: {
  readonly shown: Presentation;
  readonly onPress: () => void;
  readonly embedded: boolean;
}) {
  const { local, value, rowLabel, busy, detail } = providerControlCopy(shown);
  return (
    <View style={!embedded && styles.inset}>
      <SelectedModelControl
        name={value}
        local={local}
        label={rowLabel}
        hint={t('provider.selection.rowHint')}
        busy={busy}
        onPress={onPress}
        testID="ai-feature-select-provider"
      />
      {detail ? <AppText style={styles.detail}>{detail}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inset: { marginHorizontal: 20, marginVertical: 8 },
  detail: { color: appColors.secondary },
});
