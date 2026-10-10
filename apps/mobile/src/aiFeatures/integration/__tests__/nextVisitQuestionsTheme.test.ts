/* global describe, expect, it */

export {};

type Theme = { colors: Record<string, string> };
const { createNextVisitQuestionsTheme } =
  require('../nextVisitQuestionsRoutePresentation') as {
    createNextVisitQuestionsTheme?: (isDarkAppearance: boolean) => Theme;
  };

describe('next visit questions appearance theme', () => {
  it('provides readable color pairs for light and dark system appearance', () => {
    // This route-specific theme must follow the system instead of staying light in dark mode.
    expect(createNextVisitQuestionsTheme).toBeDefined();
    if (!createNextVisitQuestionsTheme) return;

    const light = createNextVisitQuestionsTheme(false);
    const dark = createNextVisitQuestionsTheme(true);
    expect(dark.colors.canvas).not.toBe(light.colors.canvas);
    expect(dark.colors.surface).not.toBe(light.colors.surface);
    expect(dark.colors.text).not.toBe(light.colors.text);

    for (const theme of [light, dark]) {
      expect(
        contrastRatio(theme.colors.success, theme.colors.canvas),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.colors.text, theme.colors.canvas),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.colors.text, theme.colors.surface),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.colors.textMuted, theme.colors.canvas),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.colors.accentText, theme.colors.accentSubtle),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.colors.onAccent, theme.colors.accent),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.colors.warning, theme.colors.warningSurface),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.colors.danger, theme.colors.dangerSurface),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

function contrastRatio(foreground: string, background: string): number {
  const relativeLuminance = (color: string) => {
    const channels = color
      .slice(1)
      .match(/.{2}/g)!
      .map(channel => parseInt(channel, 16) / 255)
      .map(channel =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );

    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);

  // Small text needs at least 4.5:1 contrast against its background.
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}
