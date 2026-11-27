/** Neutral app-bundled symbols only; no untrusted native name, SVG or URL, or status implication. */
export const conversationA2UIIcons = {
  info: 'info.circle',
  calendarToday: 'calendar',
} as const;

// Renderer capability is separate from the historical wire/restore allowlist.
export const conversationA2UIDisplayIcons = {
  ...conversationA2UIIcons,
  folder: 'folder',
} as const;

export type ConversationA2UIStaticLeaf =
  | {
      readonly id: string;
      readonly component: 'Divider';
      readonly axis: 'horizontal' | 'vertical';
    }
  | {
      readonly id: string;
      readonly component: 'Icon';
      readonly name: keyof typeof conversationA2UIDisplayIcons;
    };
