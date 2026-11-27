import { useRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { NavigationModal } from '../../navigation/NavigationModal';
import { NavigationPrimaryActionContext } from '../../navigation/useNavigationPrimaryAction';
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
        <View>
          {/* RN does not expose the UIKit grabber. Draw one cue and leave drag dismissal to the sheet. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={navigationText.close.accessibilityLabel}
            onAccessibilityEscape={dismiss}
            onPress={dismiss}
            style={styles.dismissControl}
            testID="conversation-personal-source-close"
          >
            <View
              accessible={false}
              pointerEvents="none"
              style={styles.grabber}
              testID="conversation-personal-source-grabber"
            />
          </Pressable>
          <AppText
            accessibilityRole="header"
            style={styles.title}
            testID="ai-feature-source-heading"
          >
            {t('ragConversation.tool.sourceKind.personalRecord')}
          </AppText>
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
    gap: 16,
  },
  dismissControl: {
    alignSelf: 'center',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: appColors.secondary,
  },
  title: { fontSize: 22, fontWeight: '700', color: appColors.text },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  message: { flexShrink: 1, color: appColors.secondary },
});
