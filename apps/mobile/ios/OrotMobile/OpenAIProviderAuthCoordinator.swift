import Foundation
import OpenAIProvider
import React
import UIKit

/// Keeps OAuth redirects and token exchanges inside the native process.
@MainActor
final class OpenAIProviderAuthCoordinator {
    static let shared = OpenAIProviderAuthCoordinator()

    private let client = ChatGPTOAuthClient()
    private let authorizationSession = OpenAIProviderAuthSession()
    private var callbackServer: LoopbackCallbackServer?
    private var signInTask: Task<ChatGPTAccountSummary, Error>?

    func signIn(existingIssuedClientID: String?) async throws -> ChatGPTAccountSummary {
        guard signInTask == nil else { throw OpenAIProviderAuthError.alreadyInProgress }
        let task = Task { try await performSignIn(existingIssuedClientID: existingIssuedClientID) }
        signInTask = task
        defer { signInTask = nil }
        return try await task.value
    }

    func signOut(
        issuedClientID: String,
        using clientOverride: ChatGPTOAuthClient? = nil,
    ) async throws -> ChatGPTSignOutResult {
        try await (clientOverride ?? client).signOut(issuedClientID: issuedClientID)
    }

    #if DEBUG && targetEnvironment(simulator)
        func probeAuthSessionReturn() async throws {
            guard signInTask == nil, callbackServer == nil else {
                throw OpenAIProviderAuthError.alreadyInProgress
            }
            let server = LoopbackCallbackServer(returnsToApp: true)
            defer { server.stop() }
            let redirectURI = try await server.start()
            var components = URLComponents(url: redirectURI, resolvingAgainstBaseURL: false)
            components?.queryItems = [
                URLQueryItem(name: "code", value: "synthetic-auth-code"),
                URLQueryItem(name: "state", value: "synthetic-auth-state"),
            ]
            guard let authorizationURL = components?.url else {
                throw OpenAIProviderAuthError.callbackMismatch
            }

            // Exercise the system callback matcher without contacting provider endpoints or exchanging code.
            try await authorizationSession.authenticate(url: authorizationURL)
            let callbackURL = try await server.waitForCallback()
            let queryItems = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems
            guard queryItems?.first(where: { $0.name == "code" })?.value == "synthetic-auth-code",
                  queryItems?.first(where: { $0.name == "state" })?.value == "synthetic-auth-state"
            else {
                throw OpenAIProviderAuthError.callbackMismatch
            }
        }

        func probeAuthSessionCancellation() async throws {
            guard signInTask == nil, callbackServer == nil else {
                throw OpenAIProviderAuthError.alreadyInProgress
            }
            // The plain loopback response has no app-return scheme, so it leaves the system session open.
            let server = LoopbackCallbackServer(returnsToApp: false)
            callbackServer = server
            defer { server.stop() }
            defer { callbackServer = nil }
            let redirectURI = try await server.start()

            // Wait until the local page loads, then cancel through the same native owner as route dismissal.
            let cancellation = Task { @MainActor in
                _ = try? await server.waitForCallback()
                cancelSignIn()
            }
            defer { cancellation.cancel() }
            do {
                try await authorizationSession.authenticate(url: redirectURI)
            } catch is CancellationError {
                return
            }
            throw OpenAIProviderAuthError.callbackMismatch
        }
    #endif

    func cancelSignIn() {
        signInTask?.cancel()
        authorizationSession.cancel()
        callbackServer?.stop()
    }

    private func performSignIn(existingIssuedClientID: String?) async throws -> ChatGPTAccountSummary {
        try Task.checkCancellation()
        let server = LoopbackCallbackServer(returnsToApp: true)
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

        // The session returns only after the loopback server answers with its fixed, secret-free app URL.
        try await authorizationSession.authenticate(url: pending.authorizationURL)
        try Task.checkCancellation()
        let callbackURL = try await server.waitForCallback()
        let access = try await client.completeAuthorization(callbackURL: callbackURL, pending: pending)
        // The client checks cancellation before saving; after its save, return the matching signed-in state.

        guard let summary = try client.listStoredAccounts().first(where: {
            $0.issuedClientID == access.issuedClientID
        }) else {
            throw ChatGPTOAuthError.accountNotFound
        }
        return summary
    }
}

private enum OpenAIProviderAuthError: LocalizedError {
    case alreadyInProgress
    case callbackMismatch

    var errorDescription: String? {
        switch self {
        case .alreadyInProgress: "ChatGPT 로그인 창이 이미 열려 있어요."
        case .callbackMismatch: "ChatGPT 로그인 복귀 검사를 완료하지 못했어요."
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
        guard beginSignOut(for: issuedClientID) else {
            Self.rejectAuth(reject, error: ChatGPTOAuthError.sessionSigningOut)
            return
        }
        Task { @MainActor in
            defer { finishSignOut(for: issuedClientID) }
            do {
                #if DEBUG && targetEnvironment(simulator)
                    let result = try await OpenAIProviderAuthCoordinator.shared.signOut(
                        issuedClientID: issuedClientID,
                        using: activeSimulatorFixtureClient,
                    )
                #else
                    let result = try await OpenAIProviderAuthCoordinator.shared.signOut(
                        issuedClientID: issuedClientID,
                    )
                #endif
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
