import Foundation
@testable import OpenAIProvider
import XCTest

final class ChatGPTCredentialCoordinationTests: XCTestCase {
    private static let issuedClientID = "oaiapp_fixture-client"
    private static let hostIdentifier = "urn:uuid:0cc04a4c-0f3a-4f49-8bda-10675883a491"
    private static let tokenPath = "/api/accounts/oauth/token"

    func testSeparateClientsSerializeRefreshForOneStoredAccount() async throws {
        let responseGate = RequestGate()
        let transport = StubOAuthHTTPTransport { request in
            if request.url?.path == "/.well-known/openid-configuration" {
                return discoveryResponse()
            }
            if request.url?.path == Self.tokenPath {
                await responseGate.wait()
                return refreshedTokenResponse()
            }
            return StubOAuthResponse(statusCode: 404, body: Data())
        }
        let store = LoadCountingCredentialStore()
        let oldAccount = syntheticAccount(expiresAt: Date(timeIntervalSince1970: 1))
        try store.saveAccount(oldAccount)
        let firstClient = ChatGPTOAuthClient(transport: transport, credentialStore: store)
        let secondClient = ChatGPTOAuthClient(transport: transport, credentialStore: store)

        let first = Task {
            try await firstClient.accountWithFreshAccessToken(issuedClientID: oldAccount.issuedClientID)
        }
        let second = Task {
            try await secondClient.accountWithFreshAccessToken(issuedClientID: oldAccount.issuedClientID)
        }
        await store.waitForLoadCount(2)
        await transport.waitForRequest(path: Self.tokenPath)
        await responseGate.open()

        let results = try await [first.value, second.value]
        let refreshRequests = await transport.recordedRequests(path: Self.tokenPath)
        XCTAssertEqual(refreshRequests.count, 1)
        XCTAssertTrue(results.allSatisfy {
            $0.credentials?.refreshToken == "fixture-refresh-token-rotated"
        })
    }

    func testAuthorizationStartedBeforeSignOutCannotRestoreCredentials() async throws {
        let fixture = try Self.loadIdentityFixture()
        let response = try JSONSerialization.data(withJSONObject: [
            "access_token": "fixture-access-token-new",
            "refresh_token": "fixture-refresh-token-new",
            "id_token": fixture.token,
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid offline_access chatgpt.tokens.use.direct",
        ])
        let transport = StubOAuthHTTPTransport { request in
            switch request.url?.path {
            case "/.well-known/openid-configuration": discoveryResponse()
            case "/api/accounts/oauth/token": StubOAuthResponse(statusCode: 200, body: response)
            case "/oauth2/v1/keys": StubOAuthResponse(statusCode: 200, body: fixture.jwks)
            case "/api/accounts/oauth/revoke": StubOAuthResponse(statusCode: 200, body: Data())
            default: StubOAuthResponse(statusCode: 404, body: Data())
            }
        }
        let store = InMemoryChatGPTCredentialStore()
        let account = ChatGPTStoredAccount(
            issuedClientID: Self.issuedClientID,
            hostIdentifier: Self.hostIdentifier,
            subject: "fixture-subject",
            grantedScopes: ["openid", "offline_access"],
            expiresAt: Date().addingTimeInterval(3600),
            credentials: ChatGPTStoredCredentials(
                accessToken: "fixture-access-token-old",
                refreshToken: "fixture-refresh-token-old",
                idToken: "fixture-id-token-old",
                tokenType: "Bearer",
            ),
        )
        try store.saveAccount(account)
        let client = ChatGPTOAuthClient(transport: transport, credentialStore: store)
        let redirect = try XCTUnwrap(URL(string: "http://127.0.0.1:54321/auth/callback"))
        let prepared = try await client.prepareAuthorization(
            hostIdentifier: Self.hostIdentifier,
            redirectURI: redirect,
            existingIssuedClientID: Self.issuedClientID,
        )
        let pending = PendingChatGPTAuthorization(
            authorizationURL: prepared.authorizationURL,
            redirectURI: prepared.redirectURI,
            hostIdentifier: prepared.hostIdentifier,
            requestedClientID: prepared.requestedClientID,
            expectedSubject: prepared.expectedSubject,
            idTokenHint: prepared.idTokenHint,
            state: prepared.state,
            nonce: "fixture-nonce",
            codeVerifier: prepared.codeVerifier,
            discovery: prepared.discovery,
            authorizationGeneration: prepared.authorizationGeneration,
        )

        _ = try await client.signOut(issuedClientID: Self.issuedClientID)

        do {
            _ = try await client.completeAuthorization(
                callbackURL: XCTUnwrap(URL(
                    string: "http://127.0.0.1:54321/auth/callback?code=fixture-code&state=\(pending.state)&client_id=\(Self.issuedClientID)",
                )),
                pending: pending,
            )
            XCTFail("A sign-in prepared before sign-out must not restore credentials afterward.")
        } catch let error as ChatGPTOAuthError {
            XCTAssertEqual(error, .sessionSigningOut)
        }

        let after = try XCTUnwrap(store.loadAccount(issuedClientID: Self.issuedClientID))
        XCTAssertEqual(after.subject, account.subject)
        XCTAssertNil(after.credentials)
    }

    private static func loadIdentityFixture() throws -> (token: String, jwks: Data) {
        let url = Bundle.module.url(forResource: "identity-tokens", withExtension: "json")!
        let data = try Data(contentsOf: url)
        let document = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let jwks = try JSONSerialization.data(withJSONObject: document["jwks"]!)
        let tokens = document["tokens"] as! [String: String]
        return (tokens["valid"]!, jwks)
    }
}

private final class LoadCountingCredentialStore: ChatGPTCredentialStore, @unchecked Sendable {
    private let base = InMemoryChatGPTCredentialStore()
    private let loadCounter = AsyncLoadCounter()

    func loadOrCreateHostIdentifier() throws -> String {
        try base.loadOrCreateHostIdentifier()
    }

    func loadAccount(issuedClientID: String) throws -> ChatGPTStoredAccount? {
        let account = try base.loadAccount(issuedClientID: issuedClientID)
        Task { await loadCounter.increment() }
        return account
    }

    func saveAccount(_ account: ChatGPTStoredAccount) throws {
        try base.saveAccount(account)
    }

    func clearCredentials(issuedClientID: String) throws {
        try base.clearCredentials(issuedClientID: issuedClientID)
    }

    func removeAccount(issuedClientID: String) throws {
        try base.removeAccount(issuedClientID: issuedClientID)
    }

    func waitForLoadCount(_ count: Int) async {
        await loadCounter.wait(until: count)
    }
}

private actor AsyncLoadCounter {
    private var count = 0
    private var waiters: [(target: Int, continuation: CheckedContinuation<Void, Never>)] = []

    func increment() {
        count += 1
        let ready = waiters.filter { $0.target <= count }
        waiters.removeAll { $0.target <= count }
        ready.forEach { $0.continuation.resume() }
    }

    func wait(until target: Int) async {
        guard count < target else { return }
        await withCheckedContinuation { waiters.append((target, $0)) }
    }
}
