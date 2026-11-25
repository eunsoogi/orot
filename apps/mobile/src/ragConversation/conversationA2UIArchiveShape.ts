import {
  conversationA2UIAlignment,
  type ConversationA2UIAlignment,
} from './conversationA2UIAlignment';
import { conversationA2UIIcons } from './conversationA2UIStaticCatalog';
type Container = 'Card' | 'Column' | 'List' | 'Row';
type Icon = keyof typeof conversationA2UIIcons;
type Axis = 'horizontal' | 'vertical';
export type Shape =
  | 0
  | readonly [Container | 'Tabs' | 'HorizontalList', ...Shape[]]
  | readonly ['Divider', Axis]
  | readonly ['Icon', Icon]
  | readonly ['WeightedText', number]
  | readonly [
      'Aligned',
      'Row' | 'Column' | 'List',
      NonNullable<ConversationA2UIAlignment['align']> | null,
      NonNullable<ConversationA2UIAlignment['justify']> | null,
      ...Shape[],
    ];
export const isIcon = (value: unknown): value is Icon =>
  typeof value === 'string' && Object.hasOwn(conversationA2UIIcons, value);
export const isAxis = (value: unknown): value is Axis =>
  value === 'horizontal' || value === 'vertical';

/** Contains only app-approved arrangement, not wire frames, IDs or independent prose. */
export type ArchivedA2UILayout = Readonly<{
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  tree: Shape;
}>;

const archiveVersions: readonly unknown[] = [1, 2, 3, 4, 5, 6, 7];
export const archiveVersion = (
  value: unknown,
): value is ArchivedA2UILayout['version'] => archiveVersions.includes(value);

const containers = new Set<Container>(['Card', 'Column', 'List', 'Row']);
export const container = (value: unknown): value is Container =>
  typeof value === 'string' && containers.has(value as Container);
export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const keys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
) =>
  Object.keys(value).length === allowed.length &&
  allowed.every(key => Object.hasOwn(value, key));

export function readAlignment(align: unknown, justify: unknown) {
  try {
    return conversationA2UIAlignment(align, justify);
  } catch {
    return undefined;
  }
}

export function readArchivedA2UIAlignment(value: unknown, list = false) {
  if (
    !record(value) ||
    Object.keys(value).some(
      key => key !== 'align' && (list || key !== 'justify'),
    )
  )
    return;
  if (list && !Object.hasOwn(value, 'align')) return;
  return readAlignment(value.align, value.justify);
}

/** Archived List alignment is vertical only. It never accepts main-axis justification. */
export function readAlignedA2UIArchiveShape(shape: unknown[], version: number) {
  const kind = shape[1];
  if (
    (kind !== 'Row' && kind !== 'Column' && kind !== 'List') ||
    shape.length < 5 ||
    shape.length > 20 ||
    (kind === 'List' && (version < 7 || shape[2] === null || shape[3] !== null))
  )
    return;
  const alignment = readAlignment(
    shape[2] === null ? undefined : shape[2],
    shape[3] === null ? undefined : shape[3],
  );
  return alignment ? ({ kind, alignment } as const) : undefined;
}
