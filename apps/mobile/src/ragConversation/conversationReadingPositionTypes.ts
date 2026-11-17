import type { openConversationReadingPosition } from './openConversationReadingPosition';
export type Position = {
  turnId: string;
  role: 'user' | 'assistant';
  offset: number;
  bottom: boolean;
};
type Storage = Awaited<ReturnType<typeof openConversationReadingPosition>>;
export type Owner = {
  id: string | null | undefined;
  alive: boolean;
  cancelled: boolean;
  reading: boolean;
  ready: boolean;
  version?: number;
  storage?: Storage;
  target?: Position;
  rows: Map<number, { y: number; height: number }>;
  origin: number | null;
  lastUser?: number;
  saveBottom?: boolean;
  write?: Position;
  writing: boolean;
};
