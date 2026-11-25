import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import type {
  DirectPhotoPresentation,
  PublishDirectPhoto,
} from './directPhotoPresentation';

const Value = createContext<DirectPhotoPresentation | null>(null);
const Publish = createContext<PublishDirectPhoto | undefined>(undefined);

/** The active Conversation workspace alone owns the mounted image preview. */
export function DirectPhotoPresentationScope({
  sessionId,
  available,
  children,
}: {
  readonly sessionId: number;
  readonly available: boolean;
  readonly children: ReactNode;
}) {
  const [value, publish] = useState<DirectPhotoPresentation | null>(null);
  useEffect(() => {
    publish(prior =>
      available && prior?.sessionId === sessionId ? prior : null,
    );
  }, [available, sessionId]);
  return (
    <Publish.Provider value={publish}>
      <Value.Provider
        value={available && value?.sessionId === sessionId ? value : null}
      >
        {children}
      </Value.Provider>
    </Publish.Provider>
  );
}

export function useDirectPhotoPublisher() {
  return useContext(Publish);
}

export function useDirectPhotoPresentation() {
  return useContext(Value);
}
