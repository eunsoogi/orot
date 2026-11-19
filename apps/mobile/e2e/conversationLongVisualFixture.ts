import type { ConversationSessionOptions } from '../src/ragConversation/conversationSessionTypes';
import { conversationVisualToolSourceSessionOptions } from './conversationVisualFixture';

/** Restore synthetic turns through the production session path without invoking a sender. */
export function longVisualSessionOptions(): ConversationSessionOptions {
  const identity = 'synthetic-long-visual-session';
  const leases = new Map<number, string>();
  const base = conversationVisualToolSourceSessionOptions.retention!;
  return {
    continuousSession: async () => ({
      id: identity,
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      model: { providerId: 'synthetic', modelId: 'visual' },
    }),
    retention: {
      ...base,
      activeIdentity: id => leases.get(id) ?? null,
      activeLease: id => (leases.has(id) ? { id: identity, version: 1 } : null),
      async attachExisting(id, durableId) {
        leases.set(id, durableId);
      },
    },
    restoreSession: async () =>
      Array.from({ length: 24 }, (_, index) => ({
        question: `합성 질문 ${index + 1}: 화면 배치를 확인합니다.`,
        answer: `합성 답변 ${index + 1}: 대화 내용이 스크롤될 때 프로필 배경과 경계를 확인합니다. 실제 개인 정보는 포함하지 않습니다.`,
        citations: [],
      })),
  };
}
