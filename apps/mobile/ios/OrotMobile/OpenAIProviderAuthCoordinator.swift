import Foundation
import OpenAIProvider
import React
import UIKit

/// Keeps OAuth redirects and token exchanges inside the native process.
@MainActor
final class OpenAIProviderAuthCoordinator {
    static let shared = OpenAIProviderAuthCoordinator()

    private let client = ChatGPTOAuthClient()
    private var callbackServer: LoopbackCallbackServer?
    private var signInTask: Task<ChatGPTAccountSummary, Error>?

    func signIn(existingIssuedClientID: String?) async throws -> ChatGPTAccountSummary {
        guard signInTask == nil else { throw OpenAIProviderAuthError.alreadyInProgress }
        let task = Task { try await performSignIn(existingIssuedClientID: existingIssuedClientID) }
        signInTask = task
        defer { signInTask = nil }
        return try await task.value
    }

    func signOut(issuedClientID: String) async throws -> ChatGPTSignOutResult {
        try await client.signOut(issuedClientID: issuedClientID)
    }

    func cancelSignIn() {
        signInTask?.cancel()
        callbackServer?.stop()
    }

    private func performSignIn(existingIssuedClientID: String?) async throws -> ChatGPTAccountSummary {
        try Task.checkCancellation()
        let server = LoopbackCallbackServer()
        callbackServer = server
        defer {
            server.stop()
            callbackServer = nil
        }

        let redirectURI = try await server.start()
        let pending = try await client.prepareAuthorization(
            redirectURI: redirectURI,
            existingIssuedClientID: existingIssuedClientID,
        )
        try Task.checkCancellation()

        // The callback URL, PKCE verifier, and returned credentials remain native-only.
        let callbackTask = Task { try await server.waitForCallback() }
        defer { callbackTask.cancel() }
        guard await openAuthorizationURL(pending.authorizationURL) else {
            throw OpenAIProviderAuthError.browserUnavailable
        }
        try Task.checkCancellation()

        let callbackURL = try await callbackTask.value
        let access = try await client.completeAuthorization(callbackURL: callbackURL, pending: pending)
        try Task.checkCancellation()

        guard let summary = try client.listStoredAccounts().first(where: {
            $0.issuedClientID == access.issuedClientID
        }) else {
            throw ChatGPTOAuthError.accountNotFound
        }
        return summary
    }

    private func openAuthorizationURL(_ url: URL) async -> Bool {
        await withCheckedContinuation { continuation in
            UIApplication.shared.open(url, options: [:]) { opened in
                continuation.resume(returning: opened)
            }
        }
    }
}

private enum OpenAIProviderAuthError: LocalizedError {
    case alreadyInProgress
    case browserUnavailable

    var errorDescription: String? {
        switch self {
        case .alreadyInProgress: "ChatGPT 로그인 창이 이미 열려 있어요."
        case .browserUnavailable: "시스템 브라우저에서 ChatGPT 로그인 페이지를 열지 못했어요."
        }
    }
}

public extension OpenAIProviderModule {
    @objc(listAccounts:rejecter:)
    func listAccounts(
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        Task { @MainActor in
            do {
                let summaries = try activeClient.listStoredAccounts()
                resolve(summaries.map(Self.accountSummaryDictionary))
            } catch {
                Self.rejectAccountList(reject, error: error)
            }
        }
    }

    @objc(signIn:resolver:rejecter:)
    func signIn(
        _ existingIssuedClientID: String?,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        Task { @MainActor in
            do {
                let summary = try await OpenAIProviderAuthCoordinator.shared.signIn(
                    existingIssuedClientID: existingIssuedClientID,
                )
                resolve(Self.accountSummaryDictionary(summary))
            } catch {
                Self.rejectAuth(reject, error: error)
            }
        }
    }

    @objc(cancelSignIn)
    func cancelSignIn() {
        Task { @MainActor in OpenAIProviderAuthCoordinator.shared.cancelSignIn() }
    }

    @objc(signOut:resolver:rejecter:)
    func signOut(
        _ issuedClientID: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        Task { @MainActor in
            do {
                let result = try await OpenAIProviderAuthCoordinator.shared.signOut(
                    issuedClientID: issuedClientID,
                )
                resolve(result == .revoked ? "revoked" : "localCredentialsCleared")
            } catch {
                Self.rejectAuth(reject, error: error)
            }
        }
    }

    private static func accountSummaryDictionary(_ summary: ChatGPTAccountSummary) -> [String: Any] {
        [
            "issuedClientID": summary.issuedClientID,
            "requiresSignIn": summary.requiresSignIn,
            "hasDirectPlanAccess": summary.hasDirectPlanAccess,
        ]
    }

    private static func rejectAccountList(_ reject: RCTPromiseRejectBlock, error: Error) {
        let message = (error as? ChatGPTOAuthError)?.errorDescription
            ?? "ChatGPT 로그인 상태를 확인하지 못했어요."
        let safeError = NSError(
            domain: "OpenAIProviderAuth",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message],
        )
        reject("CHATGPT_ACCOUNT_DISCOVERY_FAILED", message, safeError)
    }

    private static func rejectAuth(_ reject: RCTPromiseRejectBlock, error: Error) {
        let code: String
        let message: String
        if error is CancellationError {
            code = "CHATGPT_AUTH_CANCELLED"
            message = "ChatGPT 로그인을 취소했어요."
        } else if let oauthError = error as? ChatGPTOAuthError {
            code = "CHATGPT_AUTH_FAILED"
            message = oauthError.errorDescription ?? "ChatGPT 로그인을 완료하지 못했어요."
        } else if let safeError = error as? LocalizedError,
                  let description = safeError.errorDescription
        {
            code = "CHATGPT_AUTH_FAILED"
            message = description
        } else {
            code = "CHATGPT_AUTH_FAILED"
            message = "ChatGPT 로그인을 완료하지 못했어요."
        }
        let bridgedError = NSError(
            domain: "OpenAIProviderAuth",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message],
        )
        reject(code, message, bridgedError)
    }
}
