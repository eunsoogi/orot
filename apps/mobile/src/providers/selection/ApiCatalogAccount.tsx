import { t } from '../../i18n';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppButton as Button } from '../../layout/AppButton';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import { providerSettingsStyles as styles } from '../../layout/providerSettingsPresentation';
import { OpenAIProviderMark } from './OpenAIProviderMark';

/** A compact API account header matches the provider catalog without initiating authentication. */
export function ApiCatalogAccount({
  connected,
  busy,
  refresh,
  refreshLabel,
  testIDPrefix,
  titleBadge,
  onOpenAccounts,
}: {
  readonly connected: boolean;
  readonly busy: boolean;
  readonly refresh: () => void;
  readonly refreshLabel: string;
  readonly testIDPrefix: string;
  readonly titleBadge?: string;
  readonly onOpenAccounts?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.catalogContent}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <OpenAIProviderMark />
        </View>
        <Pressable
          style={styles.copy}
          accessibilityRole="button"
          accessibilityLabel={
            titleBadge
              ? `${t('modelSettings.apiAccountInfo')}, ${titleBadge}`
              : t('modelSettings.apiAccountInfo')
          }
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(value => !value)}
          testID={`${testIDPrefix}-account-details`}
        >
          {titleBadge ? (
            <View style={badgeStyles.titleLine}>
              <Text style={styles.title}>OpenAI API</Text>
              <Text style={badgeStyles.badge}>{titleBadge}</Text>
            </View>
          ) : (
            <Text style={styles.title}>OpenAI API</Text>
          )}
          <Text style={styles.secondary}>
            {connected
              ? t('modelSettings.apiConnected')
              : t('modelSettings.apiRequired')}
          </Text>
        </Pressable>
        <View
          pointerEvents="box-none"
          style={styles.catalogActionLane}
          testID={`${testIDPrefix}-account-action-lane`}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={refreshLabel}
            accessibilityState={{
              busy: busy,
              disabled: busy || !connected,
            }}
            style={styles.action}
            testID={`${testIDPrefix}-model-refresh`}
            disabled={busy || !connected}
            onPress={() => {
              refresh();
            }}
          >
            <AppSymbol
              name="arrow.triangle.2.circlepath"
              size={18}
              color={appColors.primary}
            />
          </Pressable>
        </View>
      </View>
      {expanded ? (
        <Button
          title={t('modelSettings.manageApi')}
          variant="text"
          onPress={onOpenAccounts}
          disabled={!onOpenAccounts}
          testID={`${testIDPrefix}-open-accounts`}
        />
      ) : null}
    </View>
  );
}

// Keep the provider badge next to the title, but let Dynamic Type wrap
// within the copy lane rather than shrinking the account actions.
const badgeStyles = StyleSheet.create({
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    backgroundColor: appColors.background,
    borderRadius: 99,
    color: appColors.secondary,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
