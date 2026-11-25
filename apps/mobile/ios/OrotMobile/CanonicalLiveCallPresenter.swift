import Foundation
import React
import UIKit

/// The injected presenter is native-only. The default only approves from the
/// foreground app-owned alert, never from a bridge payload.
final class CanonicalLiveCallPresenter {
    typealias Scope = CanonicalLiveNativeCallReview.Scope
    typealias Decision = (Bool?) -> Void
    typealias Show = (Scope, @escaping Decision) -> (() -> Void)?
    private let review = CanonicalLiveNativeCallReview()
    private let available: () -> Bool
    private let show: Show
    private var pending: (id: String, retire: () -> Void)?

    init(available: @escaping () -> Bool = CanonicalLiveCallPresenter.isAvailable,
         show: @escaping Show = CanonicalLiveCallPresenter.showAlert)
    {
        self.available = available
        self.show = show
    }

    static func isAvailable() -> Bool {
        #if OROT_TESTS && targetEnvironment(simulator)
            if ComposedCanonicalOpenFixture.requested, ComposedCanonicalOpenFixture.session?.protectedBlocked == true {
                return false
            }
        #endif
        return MainActor.assumeIsolated {
            UIApplication.shared.applicationState == .active && UIApplication.shared.isProtectedDataAvailable
        }
    }

    func consume(_ scope: Scope) -> Bool {
        review.consume(scope, current: available)
    }

    func retire(_ identifier: String) {
        review.retire(identifier)
        if pending?.id == identifier {
            pending?.retire()
        }
    }

    func begin(_ scope: Scope, current: @escaping () -> Bool, decide: @escaping Decision) {
        let eligible = { [available] in available() && current() }
        guard pending == nil, let authorize = review.begin(scope, current: eligible) else {
            decide(nil)
            return
        }
        var dismiss: (() -> Void)?
        var finished = false
        let finish: Decision = { [weak self] decision in
            guard let self, !finished else { return }
            finished = true
            pending = nil
            let valid = eligible()
            authorize(decision == true && valid)
            if decision == nil || !valid {
                review.retire(scope.call)
                dismiss?()
            }
            dismiss = nil
            decide(valid ? decision : nil)
        }
        pending = (scope.call, { finish(nil) })
        dismiss = show(scope, finish)
        if dismiss == nil {
            finish(nil)
        }
    }

    private static func showAlert(_ scope: Scope, decide: @escaping Decision) -> (() -> Void)? {
        var dismiss: (() -> Void)?
        MainActor.assumeIsolated {
            dismiss = presentAlert(scope, decide: decide)
        }
        return dismiss
    }

    @MainActor
    private static func presentAlert(_ scope: Scope, decide: @escaping Decision) -> (() -> Void)? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }.flatMap(\.windows).filter(\.isKeyWindow)
        guard windows.count == 1, var presenter = windows[0].rootViewController else { return nil }
        while let next = presenter.presentedViewController {
            presenter = next
        }
        guard presenter.viewIfLoaded?.window != nil, !presenter.isBeingDismissed else { return nil }
        let alert = UIAlertController(
            title: "이번 통화에서 건강 기록 도구를 사용할까요?",
            message: """
            OpenAI Responses (Live) · \(scope.capability.backendModel)
            사용할 때마다 조회 범위와 전송 결과를 따로 확인해요.
            """,
            preferredStyle: .alert,
        )
        weak var visibleAlert = alert
        var observers: [NSObjectProtocol] = []
        var timeout: DispatchWorkItem?
        var resolved = false
        let finish: Decision = { decision in
            guard !resolved else { return }
            resolved = true
            timeout?.cancel()
            timeout = nil
            observers.forEach { NotificationCenter.default.removeObserver($0) }
            observers.removeAll()
            if decision == nil {
                MainActor.assumeIsolated { visibleAlert?.dismiss(animated: false) }
            }
            decide(decision)
        }
        alert.addAction(UIAlertAction(title: "음성만 사용", style: .cancel) { _ in finish(false) })
        alert.addAction(UIAlertAction(title: "이번 통화에 사용", style: .default) { _ in finish(true) })
        for name in [UIApplication.willResignActiveNotification, UIApplication.protectedDataWillBecomeUnavailableNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
                finish(nil)
            })
        }
        let expires = DispatchWorkItem { finish(nil) }
        timeout = expires
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: expires)
        presenter.present(alert, animated: true)
        return { finish(nil) }
    }
}

extension VoiceRealtimeModule {
    static func canonicalReviewEnabled(_ identifier: String) -> Bool {
        #if OROT_TESTS && targetEnvironment(simulator)
            if ComposedCanonicalOpenFixture.requested {
                return ComposedCanonicalOpenFixture.allowed && ComposedCanonicalOpenFixture.session?.id == identifier
            }
        #endif
        return RealtimeVoiceCanonicalHealthAdmission.enabledForLiveBridge
    }

    static func canonicalAuthority(_ service: String, _ account: String) -> [String: Any]? {
        #if OROT_TESTS && targetEnvironment(simulator)
            if ComposedCanonicalOpenFixture.requested {
                return ComposedCanonicalOpenFixture.read(service, account)
            }
        #endif
        return RealtimeVoiceCanonicalHealthAdmission.read(service, account)
    }

    func emitCanonicalReviewEvent(_ name: String, _ body: [String: Any]) {
        #if OROT_TESTS && targetEnvironment(simulator)
            if ComposedCanonicalOpenFixture.requested {
                ComposedCanonicalOpenFixture.session?.receive(name, body)
                return
            }
        #endif
        sendEvent(withName: name, body: body)
    }

    @objc(reviewCanonicalLiveCall:canonical:baseline:resolver:rejecter:)
    func reviewCanonicalLiveCall(_ identifier: String, canonical: NSDictionary, baseline: NSDictionary,
                                 resolver resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async { [self] in
            guard Self.canonicalReviewEnabled(identifier), active == nil,
                  let scope = RealtimeVoiceCanonicalHealthAdmission(canonical),
                  let grant = LiveResponsesSettingsGrant(baseline),
                  let key = Self.canonicalAuthority(
                      "com.orot.mobile.voice-settings.v1", "voice-settings",
                  )?["apiKey"] as? String
            else {
                resolve(nil)
                return
            }
            canonicalCallReview.begin(.init(call: identifier, capability: scope), current: { [weak self] in
                guard let self else { return false }
                return active == nil && scope.current(base: grant, key: key, read: Self.canonicalAuthority)
            }, decide: { decision in
                resolve(decision)
            })
        }
    }

    @objc(retireCanonicalLiveReview:resolver:rejecter:)
    func retireCanonicalLiveReview(_ identifier: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter _: @escaping RCTPromiseRejectBlock)
    {
        DispatchQueue.main.async { [self] in
            canonicalCallReview.retire(identifier)
            resolve(nil)
        }
    }
}
