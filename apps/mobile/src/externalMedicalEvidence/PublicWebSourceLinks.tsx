import { t } from '../i18n';
import { Linking, Pressable } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { publicWebSources } from './publicWebSources';

/** Keep every actual web citation clickable, with the generated explanation's provenance.
 * A malformed saved locator never falls through to an arbitrary operating-system URL. */
export function PublicWebSourceLinks({
  reference,
  linkStyle,
  textStyle,
  onLinkError,
}: {
  readonly reference: EvidenceReference;
  readonly linkStyle?: StyleProp<ViewStyle>;
  readonly textStyle?: StyleProp<TextStyle>;
  readonly onLinkError: () => void;
}) {
  const sources = publicWebSources(reference);
  if (!sources)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('publicWeb.unavailable')}
        style={linkStyle}
        onPress={onLinkError}
      >
        <AppText style={textStyle}>{t('publicWeb.check')}</AppText>
      </Pressable>
    );
  return (
    <>
      {sources.map((source, index) => (
        <Pressable
          key={`${source.url}:${index}`}
          accessibilityRole="link"
          accessibilityLabel={t('publicWeb.open', { title: source.title })}
          accessibilityHint={t('publicWeb.generatedHint')}
          style={linkStyle}
          onPress={() => Linking.openURL(source.url).catch(onLinkError)}
        >
          <AppSymbol name="globe" size={18} color={appColors.primaryText} />
          <AppText numberOfLines={1} style={textStyle}>
            {t('publicWeb.prefix')}
            {source.title.length > 22
              ? `${source.title.slice(0, 21)}…`
              : source.title}
          </AppText>
        </Pressable>
      ))}
    </>
  );
}
