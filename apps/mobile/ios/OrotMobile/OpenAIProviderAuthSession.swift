import AuthenticationServices
import Foundation
import OpenAIProvider
import UIKit

/// Owns one system web-auth session and accepts only Orot's secret-free return URL.
@MainActor
final class OpenAIProviderAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var attempts = ChatGPTAuthAttemptRegistry()
    private var attemptID: UUID?
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<Void, Error>?
    private var presentationWindow: UIWindow?
    #if OROT_TESTS && DEBUG && targetEnvironment(simulator)
        private var diagnosticEventCount = 0
    #endif

    func authenticate(url: URL) async throws {
        diagnose(.authenticateEnter)
        guard let window = Self.activePresentationWindow(),
              let callbackScheme = ChatGPTOAuthConstants.appReturnURL.scheme
        else {
            diagnose(.presentationUnavailable)
            throw AuthSessionError.presentationUnavailable
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            guard let attemptID = attempts.begin() else {
                diagnose(.attemptRejected)
                continuation.resume(throwing: AuthSessionError.browserUnavailable)
                return
            }
            self.attemptID = attemptID
            diagnose(.attemptBegan, attempt: attemptID)
            self.continuation = continuation
            presentationWindow = window
            let completion: ASWebAuthenticationSession.CompletionHandler = { [weak self] callbackURL, error in
                // A delayed system callback may arrive after cancellation and a new retry starts.
                Task { @MainActor in
                    self?.diagnose(.systemCallbackReceived, attempt: attemptID)
                    self?.finish(attemptID: attemptID, callbackURL: callbackURL, error: error)
                }
            }
            let session = if #available(iOS 17.4, *) {
                ASWebAuthenticationSession(
                    url: url,
                    callback: .customScheme(callbackScheme),
                    completionHandler: completion,
                )
            } else {
                // The custom callback descriptor starts in iOS 17.4; older supported versions match by scheme.
                ASWebAuthenticationSession(
                    url: url,
                    callbackURLScheme: callbackScheme,
                    completionHandler: completion,
                )
            }
            session.presentationContextProvider = self
            self.session = session
            let started = session.start()
            diagnose(.startReturn, attempt: attemptID, started: started)
            if !started {
                finish(attemptID: attemptID, callbackURL: nil, error: AuthSessionError.browserUnavailable)
            }
        }
    }

    func cancel() {
        diagnose(.cancelRequest)
        guard let attemptID else { return }
        session?.cancel()
        diagnose(.cancelReturn, attempt: attemptID)
        // Programmatic dismissal must also release our waiting Swift task if the system callback does not arrive.
        finish(attemptID: attemptID, callbackURL: nil, error: CancellationError())
    }

    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        presentationWindow ?? Self.activePresentationWindow() ?? UIWindow()
    }

    private func finish(attemptID: UUID, callbackURL: URL?, error: Error?) {
        #if OROT_TESTS && DEBUG && targetEnvironment(simulator)
            let outcome: AuthDiagnosticOutcome = error is CancellationError ? .taskCancelled
                : (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin ? .systemCancelled
                : error != nil ? .error
                : callbackURL.map(ChatGPTOAuthConstants.isValidAppReturnURL) == true ? .validAppReturn : .invalidAppReturn
            diagnose(.finishEnter, attempt: attemptID, outcome: outcome)
        #endif
        guard attempts.finish(attemptID) else {
            diagnose(.staleFinishIgnored, attempt: attemptID)
            return
        }
        self.attemptID = nil
        guard let continuation else { return }
        self.continuation = nil
        session = nil
        presentationWindow = nil
        diagnose(.sessionReleased, attempt: attemptID)

        if let error {
            let cancelled = error is CancellationError
                || (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
            continuation.resume(throwing: cancelled ? CancellationError() : AuthSessionError.browserUnavailable)
            return
        }
        guard let callbackURL, ChatGPTOAuthConstants.isValidAppReturnURL(callbackURL) else {
            continuation.resume(throwing: AuthSessionError.invalidReturn)
            return
        }
        continuation.resume(returning: ())
    }

    /// Explicit test-only simulator diagnostics contain fixed classifications and an unrelated attempt UUID.
    /// Never include URLs, callback parameters, error descriptions, accounts, or page contents in this stream.
    private func diagnose(_ event: AuthDiagnosticEvent, attempt: UUID? = nil, started: Bool? = nil, outcome: AuthDiagnosticOutcome? = nil) {
        #if OROT_TESTS && DEBUG && targetEnvironment(simulator)
            guard ProcessInfo.processInfo.arguments.contains("-OROT_AUTH_SESSION_DIAGNOSTICS"),
                  diagnosticEventCount < 64 else { return }
            diagnosticEventCount += 1
            var record: [String: Any] = [
                "event": event.rawValue,
                "sequence": diagnosticEventCount,
                "uptimeSeconds": ProcessInfo.processInfo.systemUptime,
                "attempt": (attempt ?? attemptID)?.uuidString ?? "none",
                "applicationState": UIApplication.shared.applicationState.rawValue,
                "sceneStates": UIApplication.shared.connectedScenes.map(\.activationState.rawValue).sorted(),
                "sessionRetained": session != nil,
                "continuationRetained": continuation != nil,
                "presentationWindowRetained": presentationWindow != nil,
                "presentationWindowIsKey": presentationWindow?.isKeyWindow ?? false,
            ]
            record["started"] = started
            record["outcome"] = outcome?.rawValue
            guard let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]),
                  let text = String(data: data, encoding: .utf8) else { return }
            NSLog("OROT_AUTH_DIAGNOSTIC %@", text)
        #endif
    }

    private static func activePresentationWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
    }
}

private enum AuthSessionError: LocalizedError {
    case browserUnavailable
    case presentationUnavailable
    case invalidReturn

    var errorDescription: String? {
        switch self {
        case .browserUnavailable: "시스템 인증 창에서 ChatGPT 로그인을 완료하지 못했어요."
        case .presentationUnavailable: "ChatGPT 로그인 창을 표시할 앱 화면을 찾지 못했어요."
        case .invalidReturn: "ChatGPT 로그인 복귀 응답을 확인하지 못했어요."
        }
    }
}

/// Closed enums prevent callers from injecting dynamic URLs, errors or account content into diagnostics.
private enum AuthDiagnosticEvent: String {
    case authenticateEnter = "authenticate-enter"
    case presentationUnavailable = "presentation-unavailable"
    case attemptRejected = "attempt-rejected"
    case attemptBegan = "attempt-began"
    case startReturn = "start-return"
    case cancelRequest = "cancel-request"
    case cancelReturn = "cancel-return"
    case systemCallbackReceived = "system-callback-received"
    case finishEnter = "finish-enter"
    case staleFinishIgnored = "stale-finish-ignored"
    case sessionReleased = "session-released"
}

private enum AuthDiagnosticOutcome: String {
    case taskCancelled = "task-cancelled"
    case systemCancelled = "system-cancelled"
    case error
    case validAppReturn = "valid-app-return"
    case invalidAppReturn = "invalid-app-return"
}
