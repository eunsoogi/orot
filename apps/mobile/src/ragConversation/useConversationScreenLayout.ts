import { useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useNavigationOcclusion } from '../navigation/useNavigationContentInset';
import { conversationComposerLayout } from './conversationComposerLayout';

/** Derive composer geometry from the measured viewport and current occlusion. */
export function useConversationScreenLayout() {
  const [contentHeight, setContentHeight] = useState(0);
  const { fontScale } = useWindowDimensions();
  const occlusion = useNavigationOcclusion();
  const composerLayout = conversationComposerLayout(
    contentHeight,
    occlusion.scrollContentInsets.bottom,
    fontScale,
  );
  return { setContentHeight, occlusion, composerLayout };
}
