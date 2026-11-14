import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { sectionTabStyles as tabs } from '../../layout/sectionTabPresentation';
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
      <View style={tabs.tabs}>
        {(['language', 'voice'] as const).map(tab => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active === tab, disabled: locked }}
            disabled={locked}
            testID={`model-tab-${tab}`}
            style={[tabs.tab, active === tab && tabs.selectedTab]}
            onPress={() => {
              setActive(tab);
              if (tab === 'voice') setVisitedVoice(true);
            }}
          >
            <Text style={[tabs.label, active === tab && tabs.selectedLabel]}>
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
          <VoiceSettingsPanel
            active={active === 'voice'}
            onOpenAccounts={onOpenAccounts}
          />
        </View>
      ) : null}
    </>
  );
}
const styles = StyleSheet.create({
  hidden: { display: 'none' },
});
