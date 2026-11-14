import CoreFoundation
import Foundation
import React
import UIKit

/// Extends an active request only for the time iOS grants; expiration is terminal for the lease.
@objc(ConversationExecutionModule)
final class ConversationExecutionModule: RCTEventEmitter {
    private var requests = Set<String>()
    private var leases: [String: UIBackgroundTaskIdentifier] = [:]
    private var continued: [String: Any] = [:]
    private var saved = Set<String>()
    private var observers: [NSObjectProtocol] = []
    private var listening = false

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
        let task = UIApplication.shared.beginBackgroundTask(withName: "Conversation request") { [weak self] in
            guard let self else { return }
            #if OROT_TESTS && targetEnvironment(simulator)
                if let token = UserDefaults.standard.string(forKey: "OROT_TEST_BACKGROUND_TOKEN") {
                    signalBackgroundFailure(token)
                }
            #endif
            // A granted continued task replaces only the short execution deadline.
            if #available(iOS 26.0, *),
               let work = continued[requestId] as? ConversationContinuedProcessing, work.active
            {
                if let short = leases.removeValue(forKey: requestId) {
                    UIApplication.shared.endBackgroundTask(short)
                }
                return
            }
            endLease(requestId)
            publish(["kind": "expired", "requestId": requestId])
        }
        guard task != .invalid else { resolve(false); return }
        leases[requestId] = task
        requests.insert(requestId)
        resolve(true)
    }

    /// Called only when an authorized remote provider is dispatched, never while waiting for approval.
    @objc(work:active:)
    func work(_ requestId: String, active: Bool) {
        guard requests.contains(requestId) else { return }
        if !active {
            if #available(iOS 26.0, *) {
                (continued.removeValue(forKey: requestId) as? ConversationContinuedProcessing)?.finish(success: false)
            }
            return
        }
        guard continued[requestId] == nil, UIApplication.shared.isProtectedDataAvailable else { return }
        if #available(iOS 26.0, *) {
            let work = ConversationContinuedProcessing(status: { [weak self] state, failureCode in
                var event: [String: Any] = ["kind": "continued", "state": state, "requestId": requestId]
                if let failureCode {
                    event["failureCode"] = failureCode
                }
                self?.publish(event)
            }) { [weak self] in
                self?.endLease(requestId)
                self?.publish(["kind": "expired", "requestId": requestId])
            }
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
        if #available(iOS 26.0, *),
           let work = continued[requestId] as? ConversationContinuedProcessing, work.active
        {
            resolve(true); return
        }
        resolve(leases[requestId] != nil || (requests.contains(requestId) && UIApplication.shared.applicationState == .active))
    }

    #if OROT_TESTS && targetEnvironment(simulator)
        /// Signal the test host only after the saved answer and an actual background lease coexist.
        @objc(signalBackgroundCommit:token:resolver:rejecter:)
        func signalBackgroundCommit(_ requestId: String, token: String, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "conversation-background-retention",
                  UUID(uuidString: token) != nil,
                  UIApplication.shared.applicationState == .background,
                  leases[requestId] != nil else { resolve(false); return }
            let name = CFNotificationName("com.orot.tests.conversation-background.\(token)" as CFString)
            CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), name, nil, nil, true)
            resolve(true)
        }

        /// A test failure wakes the host without exposing request text or changing production behavior.
        @objc(signalBackgroundFailure:)
        func signalBackgroundFailure(_ token: String) {
            guard UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "conversation-background-retention",
                  UUID(uuidString: token) != nil else { return }
            let name = CFNotificationName("com.orot.tests.conversation-background-failure.\(token)" as CFString)
            CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), name, nil, nil, true)
        }
    #endif

    /// Milestones contain no prompt, answer, provider identifiers or sensitive metadata.
    @objc(answered:)
    func answered(_ requestId: String) {
        if #available(iOS 26.0, *) {
            (continued[requestId] as? ConversationContinuedProcessing)?.receivedAnswer()
        }
    }

    @objc(committed:)
    func committed(_ requestId: String) {
        if leases[requestId] != nil || continued[requestId] != nil {
            saved.insert(requestId)
        }
    }

    private func endLease(_ requestId: String) {
        requests.remove(requestId)
        let success = saved.remove(requestId) != nil
        if #available(iOS 26.0, *) {
            (continued.removeValue(forKey: requestId) as? ConversationContinuedProcessing)?.finish(success: success)
        }
        guard let task = leases.removeValue(forKey: requestId) else { return }
        UIApplication.shared.endBackgroundTask(task)
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
