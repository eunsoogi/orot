import AuthenticationServices
import Foundation
import OpenAIProvider
import UIKit

/// Owns one system web-auth session and accepts only Orot's secret-free return URL.
@MainActor
final class OpenAIProviderAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<Void, Error>?
    private var presentationWindow: UIWindow?

    func authenticate(url: URL) async throws {
        guard let window = Self.activePresentationWindow(),
              let callbackScheme = ChatGPTOAuthConstants.appReturnURL.scheme
        else {
            throw AuthSessionError.presentationUnavailable
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.continuation = continuation
            presentationWindow = window
            let completion: ASWebAuthenticationSession.CompletionHandler = { [weak self] callbackURL, error in
                Task { @MainActor in self?.finish(callbackURL: callbackURL, error: error) }
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
            if !session.start() {
                finish(callbackURL: nil, error: AuthSessionError.browserUnavailable)
            }
        }
    }

    func cancel() {
        session?.cancel()
    }

    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        presentationWindow ?? Self.activePresentationWindow() ?? UIWindow()
    }

    private func finish(callbackURL: URL?, error: Error?) {
        guard let continuation else { return }
        self.continuation = nil
        session = nil
        presentationWindow = nil

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
