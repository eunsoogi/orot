import { StyleSheet, View } from 'react-native';
import { appColorPalettes, appColors } from '../layout/appColors';
import type { DisplayMode } from './appDisplayMode';

type Palette = (typeof appColorPalettes)['light' | 'dark'];

/** Miniatures deliberately use frozen palette values: the other appearance
 * stays visible even when the user is already previewing Light or Dark. */
export function DisplayModeThumbnail({ mode }: { readonly mode: DisplayMode }) {
  const schemes = mode === 'system' ? (['light', 'dark'] as const) : [mode];
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.thumbnail}
    >
      {schemes.map(scheme => (
        <Miniature
          key={scheme}
          scheme={scheme}
          palette={appColorPalettes[scheme]}
        />
      ))}
    </View>
  );
}

function Miniature({
  scheme,
  palette,
}: {
  readonly scheme: 'light' | 'dark';
  readonly palette: Palette;
}) {
  return (
    <View
      testID={`display-preview-${scheme}`}
      style={[styles.canvas, { backgroundColor: palette.background }]}
    >
      <View style={[styles.avatar, { backgroundColor: palette.primarySoft }]} />
      <View style={[styles.heading, { backgroundColor: palette.text }]} />
      <View style={[styles.card, { backgroundColor: palette.surface }]}>
        <View style={[styles.line, { backgroundColor: palette.secondary }]} />
        <View style={[styles.shortLine, { backgroundColor: palette.border }]} />
      </View>
      <View style={[styles.reply, { backgroundColor: palette.primarySoft }]} />
      <View style={[styles.rail, { backgroundColor: palette.surface }]}>
        <View
          style={[styles.shortLine, { backgroundColor: palette.primaryText }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    width: '100%',
    aspectRatio: 0.72,
    maxWidth: 132,
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
  },
  canvas: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 4,
  },
  avatar: { width: 13, height: 13, borderRadius: 7 },
  heading: { width: '48%', height: 3, borderRadius: 2 },
  card: {
    width: '100%',
    paddingHorizontal: 3,
    paddingVertical: 5,
    gap: 3,
    borderRadius: 5,
  },
  line: { height: 2, width: '82%', borderRadius: 1 },
  shortLine: { height: 2, width: '48%', borderRadius: 1 },
  reply: { width: '68%', height: 10, borderRadius: 5, alignSelf: 'flex-end' },
  rail: {
    width: '90%',
    height: 9,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
