import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { VoiceSettingsPanel } from '../../voiceSettings/VoiceSettingsPanel';

/** Retain drafts and catalog requests across tab switches; hiding a panel never saves it. */
export function ModelSelectionTabs({
  enabled,
  children,
  locked,
  onOpenAccounts,
}: {
  readonly enabled: boolean;
  readonly children: ReactNode;
  readonly locked: boolean;
  readonly onOpenAccounts?: () => void;
}) {
  const [active, setActive] = useState<'language' | 'voice'>('language');
  const [visitedVoice, setVisitedVoice] = useState(false);
  if (!enabled) return <>{children}</>;
  return (
    <>
      <View style={styles.tabs}>
        {(['language', 'voice'] as const).map(tab => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active === tab, disabled: locked }}
            disabled={locked}
            testID={`model-tab-${tab}`}
            style={[styles.tab, active === tab && styles.active]}
            onPress={() => {
              setActive(tab);
              if (tab === 'voice') setVisitedVoice(true);
            }}
          >
            <Text>
              {tab === 'language' ? '언어 모델 선택' : '보이스 모델 선택'}
            </Text>
          </Pressable>
        ))}
      </View>
      {/* Unmount the language action dock when hidden, while the screen retains its selection. */}
      {active === 'language' ? children : null}
      {visitedVoice ? (
        <View
          style={active !== 'voice' && styles.hidden}
          accessibilityElementsHidden={active !== 'voice'}
          importantForAccessibility={
            active === 'voice' ? 'auto' : 'no-hide-descendants'
          }
        >
          <VoiceSettingsPanel onOpenAccounts={onOpenAccounts} />
        </View>
      ) : null}
    </>
  );
}
const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 16,
    backgroundColor: appColors.background,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  active: { backgroundColor: appColors.surface },
  hidden: { display: 'none' },
});
