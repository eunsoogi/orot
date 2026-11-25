import Foundation

extension RealtimeVoiceCall {
    func stop(_ identifier: String, graceful: Bool = false,
              retireMailbox: (() -> Void)? = nil, observedClose: (([String: Any]?) -> Void)? = nil) throws
    {
        guard id == identifier else { return }
        let eligible = graceful && (ready || paused) && liveIsCurrent() ? liveSessionID : nil
        let finalSession: String? = eligible.flatMap { session in
            guard managedResponsesTransport else { return session }
            return observedClose != nil && foreground() && socket.prepareManagedCaptionClose(sessionID: session) ? session : nil
        }
        let captionOwner = liveSocketEpoch.flatMap { epoch in
            finalSession.map { LiveObservedCaptionBuffer.Owner(call: identifier, session: $0, epoch: epoch) }
        }
        let caption = observedCaptions.take(captionOwner)
        liveSessionID = nil
        ready = false; audioStarting = false; paused = false; liveSocketEpoch = nil; liveStartID = nil; liveUnmuteID = nil; liveExpiresAt = nil
        liveExpiryTimer?.invalidate(); liveExpiryTimer = nil; captureEpoch = UUID(); lifecycleEpoch = UUID(); pending = nil; timer?.invalidate(); timer = nil
        cancelTools(); tools.enabled = false
        retireManagedResponses()
        retireMailbox?()
        managedResponsesTransport = false
        if finalSession == nil {
            socket.close()
        }
        connectedDuration.markStopped(identifier)
        audio.stop(); endSystemCall()
        let callback = opening; opening = nil
        // Let the bridge observe that this owner is cleared before rejecting its open.
        // If release fails, the retained owner remains available for an explicit stop retry.
        defer { callback?(.failure(Failure.stopped)) }
        do {
            if let token {
                try ownership.release(token); self.token = nil
            }
        } catch {
            if finalSession != nil {
                socket.close()
            }
            throw error
        }
        if let finalSession {
            if let observedClose {
                socket.finishObservedLive(sessionID: finalSession) { [weak self] acknowledged in
                    observedClose(acknowledged && self?.foreground() == true ? caption : nil)
                }
            } else {
                socket.finishLive(sessionID: finalSession)
            }
        } else {
            observedClose?(nil)
        }
        id = nil; item = nil; response = nil; ignoredResponses.removeAll(); awaitingInputCommit = false
    }
}
