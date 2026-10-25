/* global describe, expect, it */

const { appColorPalettes } = require('../appColors') as {
  appColorPalettes?: {
    dark: Record<string, string>;
    light: Record<string, string>;
  };
};

describe('shared app color palettes', () => {
  it('provides readable surfaces, text, and primary actions in both appearances', () => {
    // System appearance changes must update the shared tokens with accessible pairs.
    expect(appColorPalettes).toBeDefined();
    expect(appColorPalettes?.dark.background).not.toBe(
      appColorPalettes?.light.background,
    );
    expect(appColorPalettes?.dark.surface).not.toBe(
      appColorPalettes?.light.surface,
    );
    expect(appColorPalettes?.dark.text).not.toBe(appColorPalettes?.light.text);

    for (const palette of [appColorPalettes?.light, appColorPalettes?.dark]) {
      expect(
        contrastRatio(palette!.text, palette!.background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette!.text, palette!.surface),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette!.secondary, palette!.background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette!.primaryText, palette!.primarySoft),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette!.onPrimary, palette!.primaryAction),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette!.danger, palette!.background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette!.danger, palette!.surface),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette!.warning, palette!.warningSurface),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(palette!.onDanger, palette!.dangerAction),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

export {};

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

  // Small text and action labels need a 4.5:1 contrast ratio against their fill.
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}
