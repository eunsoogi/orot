import { useRef } from 'react';

export function useConversationScrollGeometry() {
  const scrollGeometry = useRef<{
    height: number;
    contentHeight: number;
    offset: number;
  } | null>(null);
  const expectedOffset = useRef<number | null>(null);
  return { scrollGeometry, expectedOffset };
}
