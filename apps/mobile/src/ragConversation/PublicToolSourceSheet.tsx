import { navigationText } from '../i18n/navigation';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { appColors } from '../layout/appColors';
import { NavigationModal } from '../navigation/NavigationModal';
import { t } from '../i18n';

export type PublicToolSourceChoice = {
  readonly title: string;
  readonly url: string;
};
export type PublicToolSourceSheetState = {
  readonly key: string;
  readonly choices?: readonly PublicToolSourceChoice[];
  readonly failed?: boolean;
  readonly opening?: boolean;
};

/** The sheet opens before I/O and never displays an unverified URL. */
export function PublicToolSourceSheet({
  state,
  destination,
  showSourceSuffix = true,
  close,
  open,
}: {
  readonly state: PublicToolSourceSheetState | null;
  readonly destination: string;
  readonly showSourceSuffix?: boolean;
  readonly close: () => void;
  readonly open: (choice: PublicToolSourceChoice) => void;
}) {
  const sourceLabel = t('ragConversation.tool.sources');
  const suffix = showSourceSuffix ? ` · ${sourceLabel}` : '';
  return (
    <NavigationModal
      visible={state !== null}
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={close}
      testID="conversation-public-tool-source-sheet"
    >
      {state ? (
        <ScrollView contentContainerStyle={styles.content}>
          <AppText accessibilityRole="header" style={styles.title}>
            {destination}
            {suffix}
          </AppText>
          {state.failed ? (
            <AppText accessibilityRole="alert">
              {t('ragConversation.tool.sourceUnavailable')}
            </AppText>
          ) : !state.choices ? (
            <>
              <ActivityIndicator accessible accessibilityRole="progressbar" />
              <AppText accessibilityLiveRegion="polite">
                {t('ragConversation.tool.verifyingSource')}
              </AppText>
            </>
          ) : (
            state.choices.map((choice, i) => (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('ragConversation.tool.openWebSource', {
                  title: choice.title,
                })}
                accessibilityState={{
                  busy: state.opening,
                  disabled: state.opening,
                }}
                key={choice.url + ':' + i}
                disabled={state.opening}
                style={styles.link}
                onPress={() => open(choice)}
              >
                <AppText style={styles.linkLabel}>{choice.title}</AppText>
              </Pressable>
            ))
          )}
          <AppButton
            variant="cancel"
            title={navigationText.close.label}
            accessibilityLabel={navigationText.close.accessibilityLabel}
            onPress={close}
          />
        </ScrollView>
      ) : null}
    </NavigationModal>
  );
}
const styles = StyleSheet.create({
  content: {
    padding: 24,
    gap: 16,
    flexGrow: 1,
    backgroundColor: appColors.background,
  },
  title: { fontSize: 22, fontWeight: '700', color: appColors.text },
  link: { minHeight: 44, justifyContent: 'center', paddingVertical: 8 },
  linkLabel: { color: appColors.primary },
});
