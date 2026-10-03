import Foundation
import XCTest
@testable import OpenAIProvider

final class ChatGPTOAuthPersistenceTests: XCTestCase {
    func testValidatedSyntheticSignInPersistsIssuedIDsIdentityScopeAndCredentials() async throws {
        let fixture = try Self.loadIdentityFixture()
        let response = try JSONSerialization.data(withJSONObject: [
            "access_token": "fixture-access-token",
            "refresh_token": "fixture-refresh-token",
            "id_token": fixture.token,
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        ])
        let transport = StubOAuthHTTPTransport { request in
            switch request.url?.path {
            case "/api/accounts/oauth/token": StubOAuthResponse(statusCode: 200, body: response)
            case "/oauth2/v1/keys": StubOAuthResponse(statusCode: 200, body: fixture.jwks)
            default: StubOAuthResponse(statusCode: 404, body: Data())
            }
        }
        let store = InMemoryChatGPTCredentialStore()
        let client = ChatGPTOAuthClient(transport: transport, credentialStore: store)
        let redirect = URL(string: "http://127.0.0.1:54321/auth/callback")!
        let discovery = OpenIDConfiguration(
            issuer: ChatGPTOAuthConstants.issuer,
            authorizationEndpoint: URL(string: "https://auth.openai.com/api/accounts/authorize")!,
            tokenEndpoint: URL(string: "https://auth.openai.com/api/accounts/oauth/token")!,
            jwksURI: URL(string: "https://auth.openai.com/oauth2/v1/keys")!,
            revocationEndpoint: URL(string: "https://auth.openai.com/api/accounts/oauth/revoke")!
        )
        let pending = PendingChatGPTAuthorization(
            authorizationURL: URL(string: "https://auth.openai.com/api/accounts/authorize")!,
            redirectURI: redirect,
            hostIdentifier: "urn:uuid:0cc04a4c-0f3a-4f49-8bda-10675883a491",
            requestedClientID: ChatGPTOAuthConstants.initialClientID,
            expectedSubject: nil,
            idTokenHint: nil,
            state: "fixture-state",
            nonce: "fixture-nonce",
            codeVerifier: "fixture-verifier",
            discovery: discovery
        )

        let access = try await client.completeAuthorization(
            callbackURL: URL(string: "http://127.0.0.1:54321/auth/callback?code=fixture-code&state=fixture-state&client_id=oaiapp_fixture-client")!,
            pending: pending
        )

        let stored = try XCTUnwrap(store.loadAccount(issuedClientID: "oaiapp_fixture-client"))
        XCTAssertEqual(access.issuedClientID, stored.issuedClientID)
        XCTAssertEqual(stored.hostIdentifier, "urn:uuid:0cc04a4c-0f3a-4f49-8bda-10675883a491")
        XCTAssertEqual(stored.subject, "fixture-subject")
        XCTAssertTrue(stored.hasDirectPlanAccess)
        XCTAssertFalse(stored.requiresSignIn)
        XCTAssertTrue(stored.credentials?.accessToken == "fixture-access-token")
        XCTAssertTrue(stored.credentials?.refreshToken == "fixture-refresh-token")
        XCTAssertTrue(stored.credentials?.idToken == fixture.token)
        let tokenRequests = await transport.recordedRequests(path: "/api/accounts/oauth/token")
        XCTAssertEqual(tokenRequests.count, 1)
        XCTAssertEqual(tokenRequests[0].url?.host, "auth.openai.com")
    }

    func testReturningSignInCannotReplaceSavedAccountIdentity() async throws {
        let fixture = try Self.loadIdentityFixture()
        let response = try JSONSerialization.data(withJSONObject: [
            "access_token": "fixture-access-token",
            "refresh_token": "fixture-refresh-token",
            "id_token": fixture.token,
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid offline_access chatgpt.tokens.use.direct",
        ])
        let transport = StubOAuthHTTPTransport { request in
            if request.url?.path == "/api/accounts/oauth/token" {
                return StubOAuthResponse(statusCode: 200, body: response)
            }
            if request.url?.path == "/oauth2/v1/keys" {
                return StubOAuthResponse(statusCode: 200, body: fixture.jwks)
            }
            return StubOAuthResponse(statusCode: 404, body: Data())
        }
        let store = InMemoryChatGPTCredentialStore()
        let selected = ChatGPTStoredAccount(
            issuedClientID: "oaiapp_fixture-client",
            hostIdentifier: "urn:uuid:0cc04a4c-0f3a-4f49-8bda-10675883a491",
            subject: "a-different-selected-subject",
            grantedScopes: [],
            expiresAt: nil,
            credentials: nil
        )
        try store.saveAccount(selected)
        let client = ChatGPTOAuthClient(transport: transport, credentialStore: store)
        let redirect = URL(string: "http://127.0.0.1:54321/auth/callback")!
        let discovery = OpenIDConfiguration(
            issuer: ChatGPTOAuthConstants.issuer,
            authorizationEndpoint: URL(string: "https://auth.openai.com/api/accounts/authorize")!,
            tokenEndpoint: URL(string: "https://auth.openai.com/api/accounts/oauth/token")!,
            jwksURI: URL(string: "https://auth.openai.com/oauth2/v1/keys")!,
            revocationEndpoint: URL(string: "https://auth.openai.com/api/accounts/oauth/revoke")!
        )
        let pending = PendingChatGPTAuthorization(
            authorizationURL: URL(string: "https://auth.openai.com/api/accounts/authorize")!,
            redirectURI: redirect,
            hostIdentifier: selected.hostIdentifier,
            requestedClientID: selected.issuedClientID,
            expectedSubject: selected.subject,
            idTokenHint: nil,
            state: "fixture-state",
            nonce: "fixture-nonce",
            codeVerifier: "fixture-verifier",
            discovery: discovery
        )

        do {
            _ = try await client.completeAuthorization(
                callbackURL: URL(string: "http://127.0.0.1:54321/auth/callback?code=fixture-code&state=fixture-state")!,
                pending: pending
            )
            XCTFail("A returning sign-in must match the saved account identity.")
        } catch let error as ChatGPTOAuthError {
            XCTAssertEqual(error, .accountIdentityMismatch)
        }

        let after = try XCTUnwrap(store.loadAccount(issuedClientID: selected.issuedClientID))
        XCTAssertEqual(after.subject, selected.subject)
        XCTAssertTrue(after.requiresSignIn)
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
