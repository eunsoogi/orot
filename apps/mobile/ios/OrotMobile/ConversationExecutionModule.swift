import CoreFoundation
import Foundation
import React
import UIKit

/// Extends an active request only for the time iOS grants; expiration is terminal for the lease.
@objc(ConversationExecutionModule)
final class ConversationExecutionModule: RCTEventEmitter {
    private var requests = Set<String>()
    private let nativeOwnership = ConversationNativeSceneOwnership()
    private var continuedEpochs: [String: UUID] = [:]
    private var continued: [String: Any] = [:]
    private var saved = Set<String>()
    private var observers: [NSObjectProtocol] = []
    private var listening = false
    private var deadlineTimer: Timer?
    private var pauseWarnings: [String: UUID] = [:]

    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override var methodQueue: DispatchQueue! {
        DispatchQueue.main
    }

    override func supportedEvents() -> [String]! {
        ["ConversationExecutionChanged"]
    }

    override func startObserving() {
        listening = true
        let center = NotificationCenter.default
        // Use the same native emitter as the deferred receipt to preserve phase ordering.
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self, !requests.isEmpty else { return }
            pauseWarnings.removeAll()
            observeConversationExecution(.foreground)
            publish(["kind": "continuation-foreground"])
        })
        observers.append(nativeOwnership.observeBackground(center, handler: { [weak self] in self?.rearmOwnedRequests() }))
        for name in [UIApplication.protectedDataWillBecomeUnavailableNotification,
                     UIApplication.protectedDataDidBecomeAvailableNotification]
        {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                // The will-unavailable notification precedes the getter changing to false.
                let available = notification.name == UIApplication.protectedDataDidBecomeAvailableNotification
                #if OROT_TESTS && targetEnvironment(simulator)
                    if !available, let token = UserDefaults.standard.string(forKey: "OROT_TEST_BACKGROUND_TOKEN") {
                        self?.signalBackgroundFailure(token)
                    }
                #endif
                self?.publish(["kind": "protectedData", "available": available])
            })
        }
    }

    override func stopObserving() {
        listening = false
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers.removeAll()
    }

    private func publish(_ body: [String: Any]) {
        if listening {
            sendEvent(withName: "ConversationExecutionChanged", body: body)
        }
    }

    @objc(begin:resolver:rejecter:)
    func begin(_ requestId: String, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        guard !requestId.isEmpty, !requests.contains(requestId) else { resolve(false); return }
        if requests.isEmpty {
            nativeOwnership.bindWindow()
        }
        guard beginShortLease(requestId) else { resolve(false); return }
        requests.insert(requestId)
        if deadlineTimer == nil {
            deadlineTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                self?.requestSafePauseBeforeExpiration()
            }
        }
        resolve(true)
    }

    private func beginShortLease(_ requestId: String) -> Bool {
        nativeOwnership.beginShortLease(requestId) { [weak self] in
            guard let self else { return }
            pauseWarnings.removeValue(forKey: requestId)
            if ConversationLeaseOwnership.retainAfterShortExpiry(hasContinued: conversationContinuedWorkIsActive(continued[requestId]), hasVisibleOwner: nativeOwnership.hasVisibleForegroundOwner) {
                return
            }
            observeConversationExecution(.shortLeaseExpired)
            expireRequest(requestId)
        }
    }

    private func rearmOwnedRequests() {
        for id in Array(requests) where ConversationLeaseOwnership.rearmForBackground(hasShortLease: nativeOwnership.hasShortLease(id), hasContinued: conversationContinuedWorkIsActive(continued[id])) {
            if !UIApplication.shared.isProtectedDataAvailable || !beginShortLease(id) {
                expireRequest(id)
            }
        }
    }

    private func expireRequest(_ requestId: String) {
        guard requests.contains(requestId) else { return }
        observeConversationBackgroundFixtureFailure(self)
        endLease(requestId)
        publish(["kind": "expired", "requestId": requestId])
    }

    /// Admit durably owned foreground work; provider authorization remains independent.
    @objc(work:active:)
    func work(_ requestId: String, active: Bool) {
        guard requests.contains(requestId) else { return }
        if !active {
            continuedEpochs.removeValue(forKey: requestId)
            if #available(iOS 26.0, *) {
                (continued.removeValue(forKey: requestId) as? ConversationContinuedProcessing)?.finish(success: false)
            }
            return
        }
        guard continued[requestId] == nil, UIApplication.shared.isProtectedDataAvailable else { return }
        // Work outside the foreground cannot submit a continued task. Do not
        // cache that non-attempt: a later eligible foreground stage may try.
        // Actual scheduler refusals remain cached, so they are never retried here.
        guard UIApplication.shared.applicationState == .active else {
            observeConversationExecution(.deferredInactive)
            publish(["kind": "continued", "state": "continued-deferred-inactive", "requestId": requestId])
            return
        }
        if #available(iOS 26.0, *) {
            let epoch = UUID()
            let work = ConversationContinuedProcessing(status: { [weak self] state, failureCode in
                guard let self, continuedEpochs[requestId] == epoch else { return }
                var event: [String: Any] = ["kind": "continued", "state": state, "requestId": requestId]
                if let failureCode {
                    event["failureCode"] = failureCode
                }
                publish(event)
            }) { [weak self] in
                guard let self, continuedEpochs[requestId] == epoch else { return }
                continuedEpochs.removeValue(forKey: requestId)
                if nativeOwnership.hasVisibleForegroundOwner {
                    return
                }
                expireRequest(requestId)
            }
            continuedEpochs[requestId] = epoch
            continued[requestId] = work
            work.begin()
        }
    }

    @objc(end:)
    func end(_ requestId: String) {
        endLease(requestId)
    }

    @objc(isActive:resolver:rejecter:)
    func isActive(_ requestId: String, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        resolve(conversationContinuedWorkIsActive(continued[requestId]) || nativeOwnership.hasShortLease(requestId) || (requests.contains(requestId) && nativeOwnership.hasVisibleForegroundOwner))
    }

    @objc(isPauseCurrent:warning:resolver:rejecter:)
    func isPauseCurrent(_ requestId: String, warning: String, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        // A queued JS warning can outlive its exact background visit or a newer continued grant.
        let application = UIApplication.shared
        guard application.applicationState == .background, application.isProtectedDataAvailable,
              nativeOwnership.hasShortLease(requestId), !conversationContinuedWorkIsActive(continued[requestId])
        else { resolve(false); return }
        resolve(pauseWarnings[requestId]?.uuidString == warning)
    }

    #if OROT_TESTS && targetEnvironment(simulator)
        func ownsShortLease(_ requestId: String) -> Bool {
            nativeOwnership.hasShortLease(requestId)
        }

        /// Read-only fixture access; the original UIKit lease must have been released.
        func continuedGrantWithoutShortLease(_ requestId: String) -> Any? {
            !nativeOwnership.hasShortLease(requestId) ? continued[requestId] : nil
        }

    #endif

    /// Milestones contain no prompt, answer, provider identifiers or sensitive metadata.
    @objc(reportStatus:stage:)
    func reportStatus(_ requestId: String, stage: String) {
        if #available(iOS 26.0, *), UIApplication.shared.isProtectedDataAvailable {
            (continued[requestId] as? ConversationContinuedProcessing)?.report(stage)
        }
    }

    @objc(committed:)
    func committed(_ requestId: String) {
        if nativeOwnership.hasShortLease(requestId) || continued[requestId] != nil {
            saved.insert(requestId)
        }
    }

    /// Only a finite short-lease deadline requests a safe graph drain. A granted continued
    /// task keeps running until completion or the system's actual cancellation/expiration.
    private func requestSafePauseBeforeExpiration() {
        guard UIApplication.shared.applicationState == .background else { return }
        let remaining = UIApplication.shared.backgroundTimeRemaining
        guard remaining.isFinite, remaining > 0, remaining <= 10 else { return }
        for requestId in requests where nativeOwnership.hasShortLease(requestId) && pauseWarnings[requestId] == nil && !conversationContinuedWorkIsActive(continued[requestId]) {
            let warning = UUID()
            pauseWarnings[requestId] = warning
            observeConversationExecution(.shortLeaseDrain)
            publish(["kind": "pause-requested", "requestId": requestId, "warning": warning.uuidString])
        }
    }

    private func endLease(_ requestId: String) {
        requests.remove(requestId)
        pauseWarnings.removeValue(forKey: requestId)
        continuedEpochs.removeValue(forKey: requestId)
        if requests.isEmpty {
            nativeOwnership.clearWindow()
            deadlineTimer?.invalidate()
            deadlineTimer = nil
        }
        let success = saved.remove(requestId) != nil
        if #available(iOS 26.0, *) {
            (continued.removeValue(forKey: requestId) as? ConversationContinuedProcessing)?.finish(success: success)
        }
        nativeOwnership.finishShortLease(requestId)
    }

    @objc(protectedDataAvailable:rejecter:)
    func protectedDataAvailable(_ resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        resolve(UIApplication.shared.isProtectedDataAvailable)
    }

    override func invalidate() {
        stopObserving()
        for requestId in requests {
            endLease(requestId)
        }
        super.invalidate()
    }
}
