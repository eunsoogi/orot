import { useState } from 'react';

export const classificationResultRowBottomInset = 8;

/** Short groups center within the safe vertical lane; longer groups fill it.
 * Native content height includes fonts/padding without resizing the hidden list. */
export function useClassificationResultGroupTop({
  side,
  height,
  width,
  scale,
  captionHeight,
  naturalRow,
  count,
  top,
}: {
  readonly side: boolean;
  readonly height: number;
  readonly width: number;
  readonly scale: number;
  readonly captionHeight: number;
  readonly naturalRow: number;
  readonly count: number;
  readonly top: number;
}) {
  const key = `${count}/${scale}/${width}`;
  const [content, setContent] = useState<{ key: string; height: number }>();
  const rowsHeight =
    content?.key === key
      ? content.height
      : count
        ? naturalRow * count + classificationResultRowBottomInset
        : 0;
  return {
    groupTop: side
      ? Math.max(0, (height - captionHeight - rowsHeight) / 2)
      : top,
    onContentSizeChange: side
      ? (_width: number, nextHeight: number) => {
          if (Number.isFinite(nextHeight) && nextHeight > 0)
            setContent(previous =>
              previous?.key === key && previous.height === nextHeight
                ? previous
                : { key, height: nextHeight },
            );
        }
      : undefined,
  };
}
