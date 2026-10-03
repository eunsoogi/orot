import Foundation
import XCTest
@testable import OpenAIProvider

final class ChatGPTSessionManagerTests: XCTestCase {
    private static let clientID = "oaiapp_fixture_client"
    private static let tokenPath = "/api/accounts/oauth/token"
    private static let revokePath = "/api/accounts/oauth/revoke"
    private static let fixedNow = Date(timeIntervalSince1970: 1_800_000_000)

    func testConcurrentRefreshUsesOneRotatingTokenRequestAndSavesReplacement() async throws {
        let gate = RequestGate()
        let transport = StubOAuthHTTPTransport { request in
            if request.url?.path == "/.well-known/openid-configuration" { return discoveryResponse() }
            if request.url?.path == Self.tokenPath {
                await gate.wait()
                return refreshedTokenResponse()
            }
            return StubOAuthResponse(statusCode: 404, body: Data())
        }
        let store = InMemoryChatGPTCredentialStore()
        let original = syntheticAccount(expiresAt: Self.fixedNow.addingTimeInterval(-1))
        try store.saveAccount(original)
        let manager = ChatGPTSessionManager(
            transport: transport,
            credentialStore: store,
            now: { Self.fixedNow }
        )

        let clientID = Self.clientID
        let callers = (0..<12).map { _ in
            Task { try await manager.accountWithFreshAccessToken(issuedClientID: clientID) }
        }
        await transport.waitForRequest(path: Self.tokenPath)
        await gate.open()
        var results: [ChatGPTStoredAccount] = []
        for caller in callers { results.append(try await caller.value) }

        let requests = await transport.recordedRequests(path: Self.tokenPath)
        XCTAssertEqual(results.count, 12)
        XCTAssertEqual(requests.count, 1)
        XCTAssertTrue(results.allSatisfy { $0.expiresAt == Self.fixedNow.addingTimeInterval(3600) })
        XCTAssertTrue(results.allSatisfy { $0.credentials?.accessToken == "fixture-access-token-rotated" })
        XCTAssertTrue(results.allSatisfy { $0.credentials?.refreshToken == "fixture-refresh-token-rotated" })
        XCTAssertEqual(results.first?.grantedScopes, original.grantedScopes)
        let fields = Self.formFields(requests[0].httpBody)
        XCTAssertEqual(fields["grant_type"], "refresh_token")
        XCTAssertEqual(fields["client_id"], clientID)
        XCTAssertEqual(fields["resource"], ChatGPTOAuthConstants.resource)
        XCTAssertNil(fields["scope"])
        XCTAssertTrue(fields["refresh_token"] == "fixture-refresh-token")
        XCTAssertEqual(try store.loadAccount(issuedClientID: clientID)?.credentials?.refreshToken, "fixture-refresh-token-rotated")
    }

    func testRefreshNowRotatesCredentialsEvenBeforeExpiry() async throws {
        let transport = StubOAuthHTTPTransport { request in
            if request.url?.path == "/.well-known/openid-configuration" { return discoveryResponse() }
            if request.url?.path == Self.tokenPath { return refreshedTokenResponse() }
            return StubOAuthResponse(statusCode: 404, body: Data())
        }
        let store = InMemoryChatGPTCredentialStore()
        try store.saveAccount(syntheticAccount(expiresAt: Self.fixedNow.addingTimeInterval(3600)))
        let manager = ChatGPTSessionManager(
            transport: transport,
            credentialStore: store,
            now: { Self.fixedNow }
        )

        let refreshed = try await manager.refreshNow(issuedClientID: Self.clientID)

        let requests = await transport.recordedRequests(path: Self.tokenPath)
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(refreshed.credentials?.refreshToken, "fixture-refresh-token-rotated")
    }

    func testTransientRefreshFailurePreservesStoredCredentials() async throws {
        let transport = StubOAuthHTTPTransport { request in
            if request.url?.path == "/.well-known/openid-configuration" { return discoveryResponse() }
            return StubOAuthResponse(statusCode: 503, body: Data(#"{"error":"temporarily_unavailable"}"#.utf8))
        }
        let store = InMemoryChatGPTCredentialStore()
        let original = syntheticAccount(expiresAt: Self.fixedNow.addingTimeInterval(-1))
        try store.saveAccount(original)
        let manager = ChatGPTSessionManager(transport: transport, credentialStore: store, now: { Self.fixedNow })

        do {
            _ = try await manager.refreshNow(issuedClientID: Self.clientID)
            XCTFail("A temporary provider failure must be surfaced.")
        } catch let error as ChatGPTOAuthError {
            XCTAssertEqual(error, .providerFailure)
        }

        let afterFailure = try store.loadAccount(issuedClientID: Self.clientID)
        XCTAssertTrue(afterFailure?.credentials == original.credentials)
        XCTAssertEqual(afterFailure?.expiresAt, original.expiresAt)
    }

    func testInvalidGrantClearsTokensButKeepsIssuedRegistrationAndIdentity() async throws {
        let transport = StubOAuthHTTPTransport { request in
            if request.url?.path == "/.well-known/openid-configuration" { return discoveryResponse() }
            return StubOAuthResponse(statusCode: 400, body: Data(#"{"error":"invalid_grant"}"#.utf8))
        }
        let store = InMemoryChatGPTCredentialStore()
        try store.saveAccount(syntheticAccount(expiresAt: Self.fixedNow.addingTimeInterval(-1)))
        let manager = ChatGPTSessionManager(transport: transport, credentialStore: store, now: { Self.fixedNow })

        do {
            _ = try await manager.refreshNow(issuedClientID: Self.clientID)
            XCTFail("A terminal refresh error must require sign-in again.")
        } catch let error as ChatGPTOAuthError {
            XCTAssertEqual(error, .reauthorizationRequired)
        }

        let retained = try XCTUnwrap(store.loadAccount(issuedClientID: Self.clientID))
        XCTAssertEqual(retained.issuedClientID, Self.clientID)
        XCTAssertEqual(retained.hostIdentifier, "urn:uuid:0cc04a4c-0f3a-4f49-8bda-10675883a491")
        XCTAssertEqual(retained.subject, "fixture-subject")
        XCTAssertNil(retained.credentials)
        XCTAssertTrue(retained.requiresSignIn)
    }

    func testSignOutRevokesRefreshTokenThenClearsOnlyCredentials() async throws {
        let transport = StubOAuthHTTPTransport { request in
            if request.url?.path == "/.well-known/openid-configuration" { return discoveryResponse() }
            if request.url?.path == Self.revokePath { return StubOAuthResponse(statusCode: 200, body: Data()) }
            return StubOAuthResponse(statusCode: 404, body: Data())
        }
        let store = InMemoryChatGPTCredentialStore()
        try store.saveAccount(syntheticAccount(expiresAt: Self.fixedNow.addingTimeInterval(3600)))
        let manager = ChatGPTSessionManager(transport: transport, credentialStore: store, now: { Self.fixedNow })

        let outcome = try await manager.signOut(issuedClientID: Self.clientID)

        XCTAssertEqual(outcome, .revoked)
        let requests = await transport.recordedRequests(path: Self.revokePath)
        XCTAssertEqual(requests.count, 1)
        let fields = Self.formFields(requests[0].httpBody)
        XCTAssertEqual(fields["client_id"], Self.clientID)
        XCTAssertEqual(fields["token_type_hint"], "refresh_token")
        XCTAssertTrue(fields["token"] == "fixture-refresh-token")
        let retained = try XCTUnwrap(store.loadAccount(issuedClientID: Self.clientID))
        XCTAssertNil(retained.credentials)
        XCTAssertEqual(retained.subject, "fixture-subject")
        XCTAssertEqual(retained.hostIdentifier, "urn:uuid:0cc04a4c-0f3a-4f49-8bda-10675883a491")
    }

    func testSignOutClearsLocalCredentialsWhenRemoteRevocationCannotBeConfirmed() async throws {
        let transport = StubOAuthHTTPTransport { request in
            if request.url?.path == "/.well-known/openid-configuration" { return discoveryResponse() }
            return StubOAuthResponse(statusCode: 503, body: Data())
        }
        let store = InMemoryChatGPTCredentialStore()
        try store.saveAccount(syntheticAccount(expiresAt: Self.fixedNow.addingTimeInterval(3600)))
        let manager = ChatGPTSessionManager(transport: transport, credentialStore: store, now: { Self.fixedNow })

        let outcome = try await manager.signOut(issuedClientID: Self.clientID)

        XCTAssertEqual(outcome, .localCredentialsCleared)
        let requests = await transport.recordedRequests(path: Self.revokePath)
        XCTAssertEqual(requests.count, 3)
        let retained = try XCTUnwrap(store.loadAccount(issuedClientID: Self.clientID))
        XCTAssertNil(retained.credentials)
        XCTAssertEqual(retained.issuedClientID, Self.clientID)
        XCTAssertEqual(retained.subject, "fixture-subject")
    }

    private static func formFields(_ body: Data?) -> [String: String] {
        guard let body, let text = String(data: body, encoding: .utf8) else { return [:] }
        return Dictionary(uniqueKeysWithValues: text.split(separator: "&").compactMap { item in
            let pair = item.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard pair.count == 2 else { return nil }
            let value = String(pair[1]).replacingOccurrences(of: "+", with: " ")
            return (String(pair[0]), value.removingPercentEncoding ?? value)
        })
    }
}
