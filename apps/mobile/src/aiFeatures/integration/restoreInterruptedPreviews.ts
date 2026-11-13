/** Interrupted previews remain separate from validated answers and retained history. */
export async function restoreInterruptedPreviews<
  T extends { toolMessageId?: string },
>(
  turns: readonly T[],
  interrupted: readonly { id: string }[],
  storage: {
    readInterruptedPreview(lease: {
      requestId: string;
      sessionId: string;
      sessionVersion: number;
    }): Promise<string | null>;
  },
  sessionId: string,
  version: number,
) {
  const previews = new Map(
    await Promise.all(
      interrupted.map(
        async request =>
          [
            request.id,
            await storage.readInterruptedPreview({
              requestId: request.id,
              sessionId,
              sessionVersion: version,
            }),
          ] as const,
      ),
    ),
  );
  return turns.map(turn => {
    const request = interrupted.find(item => item.id === turn.toolMessageId);
    if (!request) return turn;
    const preview = previews.get(request.id);
    return {
      ...turn,
      interrupted: true as const,
      ...(preview ? { preview } : {}),
    };
  });
}
