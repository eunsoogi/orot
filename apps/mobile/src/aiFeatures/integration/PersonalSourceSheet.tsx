import { useRef, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationModal } from '../../navigation/NavigationModal';
import { NavigationPrimaryActionContext } from '../../navigation/useNavigationPrimaryAction';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { navigationText } from '../../i18n/navigation';
import { t } from '../../i18n';

/** Keep the title and dismissal stable while the protected body changes state. */
export function PersonalSourceSheet({
  children,
  close,
}: {
  readonly children: ReactNode;
  readonly close: () => void;
}) {
  const closing = useRef(false);
  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    close();
  };
  return (
    <NavigationModal
      visible
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={dismiss}
      testID="conversation-personal-source-sheet"
    >
      <View style={styles.shell} accessibilityViewIsModal>
        <View style={styles.header}>
          <AppText
            accessibilityRole="header"
            style={styles.title}
            testID="ai-feature-source-heading"
          >
            {t('ragConversation.tool.sourceKind.personalRecord')}
          </AppText>
          <AppButton
            variant="cancel"
            title={navigationText.close.label}
            accessibilityLabel={navigationText.close.accessibilityLabel}
            testID="conversation-personal-source-close"
            onPress={dismiss}
          />
        </View>
        <NavigationPrimaryActionContext.Provider value={null}>
          {children}
        </NavigationPrimaryActionContext.Provider>
      </View>
    </NavigationModal>
  );
}

export function PersonalSourceSheetStatus({
  unavailable,
  onLayout,
}: {
  readonly unavailable: boolean;
  readonly onLayout?: () => void;
}) {
  return (
    <View
      testID={onLayout ? 'ai-feature-source-detail' : undefined}
      onLayout={onLayout}
      style={styles.status}
    >
      {!unavailable ? (
        <ActivityIndicator accessible accessibilityRole="progressbar" />
      ) : null}
      <AppText
        accessibilityRole={unavailable ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        style={styles.message}
        testID={
          unavailable
            ? 'ai-feature-source-unavailable'
            : 'ai-feature-source-loading'
        }
      >
        {t(
          unavailable
            ? 'aiFeatures.source.unavailable'
            : 'aiFeatures.source.loading',
        )}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: appColors.background,
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { flex: 1, fontSize: 22, fontWeight: '700', color: appColors.text },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  message: { flexShrink: 1, color: appColors.secondary },
});
