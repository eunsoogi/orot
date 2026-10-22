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
        accessibilityLabel="웹 출처 확인 불가"
        style={linkStyle}
        onPress={onLinkError}
      >
        <AppText style={textStyle}>웹 출처 확인</AppText>
      </Pressable>
    );
  return (
    <>
      {sources.map((source, index) => (
        <Pressable
          key={`${source.url}:${index}`}
          accessibilityRole="link"
          accessibilityLabel={`웹 출처 열기 · ${source.title}`}
          accessibilityHint="웹자료를 바탕으로 AI가 정리한 설명의 출처예요."
          style={linkStyle}
          onPress={() => Linking.openURL(source.url).catch(onLinkError)}
        >
          <AppSymbol name="globe" size={18} color={appColors.primaryText} />
          <AppText numberOfLines={1} style={textStyle}>
            웹 ·{' '}
            {source.title.length > 22
              ? `${source.title.slice(0, 21)}…`
              : source.title}
          </AppText>
        </Pressable>
      ))}
    </>
  );
}
