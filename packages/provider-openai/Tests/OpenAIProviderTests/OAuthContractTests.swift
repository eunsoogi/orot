import Foundation
import XCTest
@testable import OpenAIProvider

final class OAuthContractTests: XCTestCase {
    func testPKCEChallengeMatchesRFC7636S256Vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

        XCTAssertEqual(
            PKCE.challenge(for: verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        )
    }

    func testEachAuthorizationAttemptGetsFreshURLSafeStateNonceAndVerifier() throws {
        let values = try (0..<9).map { _ in try PKCE.randomURLSafeValue() }

        XCTAssertEqual(Set(values).count, values.count)
        XCTAssertTrue(values.allSatisfy { $0.count == 43 })
        XCTAssertTrue(values.allSatisfy { $0.allSatisfy(Self.isBase64URLCharacter) })
    }

    func testHostIdentifierSurvivesStoreRecreation() {
        let suite = "com.orot.oauth-test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        let first = UserDefaultsHostIdentifierStore(defaults: defaults).loadOrCreate()
        let afterReopen = UserDefaultsHostIdentifierStore(defaults: defaults).loadOrCreate()

        XCTAssertEqual(first, afterReopen)
        XCTAssertTrue(UserDefaultsHostIdentifierStore.isValidHostIdentifier(first))
    }

    func testAuthorizationRequestCarriesRequiredLoopbackPKCEAndPermissionValues() throws {
        let redirect = URL(string: "http://127.0.0.1:54321/auth/callback")!
        let discovery = OpenIDConfiguration(
            issuer: ChatGPTOAuthConstants.issuer,
            authorizationEndpoint: URL(string: "https://auth.openai.com/api/accounts/authorize")!,
            tokenEndpoint: URL(string: "https://auth.openai.com/api/accounts/oauth/token")!,
            jwksURI: URL(string: "https://auth.openai.com/oauth2/v1/keys")!,
            revocationEndpoint: URL(string: "https://auth.openai.com/api/accounts/oauth/revoke")!
        )
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        let url = try AuthorizationRequestBuilder.build(
            discovery: discovery,
            hostIdentifier: "urn:uuid:80f64234-5a94-4f5d-b510-37ea412918ca",
            redirectURI: redirect,
            state: "fresh-state",
            nonce: "fresh-nonce",
            verifier: verifier,
            agentName: "Orot"
        )
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        let parameters = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })

        XCTAssertEqual(parameters["client_id"], "dynamic_agent_client")
        XCTAssertEqual(parameters["agent_name_hint"], "Orot")
        XCTAssertEqual(parameters["ext_agent_host_id"], "urn:uuid:80f64234-5a94-4f5d-b510-37ea412918ca")
        XCTAssertEqual(parameters["response_type"], "code")
        XCTAssertEqual(parameters["redirect_uri"], redirect.absoluteString)
        XCTAssertEqual(parameters["resource"], ChatGPTOAuthConstants.resource)
        XCTAssertEqual(parameters["code_challenge_method"], "S256")
        XCTAssertEqual(parameters["code_challenge"], PKCE.challenge(for: verifier))
        XCTAssertEqual(parameters["state"], "fresh-state")
        XCTAssertEqual(parameters["nonce"], "fresh-nonce")
        XCTAssertEqual(Set(parameters["scope", default: ""].split(separator: " ").map(String.init)), Set(ChatGPTOAuthConstants.scopes.split(separator: " ").map(String.init)))
    }

    func testReturningAccountReusesIssuedClientIDAndOnlyAddsRetainedIDTokenHint() throws {
        let redirect = URL(string: "http://127.0.0.1:54321/auth/callback")!
        let discovery = OpenIDConfiguration(
            issuer: ChatGPTOAuthConstants.issuer,
            authorizationEndpoint: URL(string: "https://auth.openai.com/api/accounts/authorize")!,
            tokenEndpoint: URL(string: "https://auth.openai.com/api/accounts/oauth/token")!,
            jwksURI: URL(string: "https://auth.openai.com/oauth2/v1/keys")!,
            revocationEndpoint: URL(string: "https://auth.openai.com/api/accounts/oauth/revoke")!
        )
        let url = try AuthorizationRequestBuilder.build(
            discovery: discovery,
            hostIdentifier: "urn:uuid:80f64234-5a94-4f5d-b510-37ea412918ca",
            redirectURI: redirect,
            state: "fresh-state",
            nonce: "fresh-nonce",
            verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
            agentName: "Orot",
            clientID: "oaiapp_fixture_client",
            idTokenHint: "synthetic-id-token-hint"
        )
        let parameters = Dictionary(
            uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map {
                ($0.name, $0.value ?? "")
            }
        )

        XCTAssertEqual(parameters["client_id"], "oaiapp_fixture_client")
        XCTAssertEqual(parameters["id_token_hint"], "synthetic-id-token-hint")
        XCTAssertNil(parameters["agent_name_hint"])
    }

    func testCallbackAcceptsOnlyMatchingLoopbackStateAndIssuedClientID() throws {
        let callback = try OAuthCallbackParser.parse(
            URL(string: "http://127.0.0.1:54321/auth/callback?code=one-time-code&state=expected&client_id=oaiapp_registered")!,
            expectedState: "expected",
            expectedRedirectURI: URL(string: "http://127.0.0.1:54321/auth/callback")!
        )

        XCTAssertEqual(callback, OAuthCallback(code: "one-time-code", issuedClientID: "oaiapp_registered"))
    }

    func testReturningCallbackMayOmitSelectedClientIDButCannotReplaceIt() throws {
        let redirect = URL(string: "http://127.0.0.1:54321/auth/callback")!
        let returning = try OAuthCallbackParser.parse(
            URL(string: "http://127.0.0.1:54321/auth/callback?code=one-time-code&state=expected")!,
            expectedState: "expected",
            expectedRedirectURI: redirect,
            expectedClientID: "oaiapp_selected_account"
        )
        XCTAssertEqual(returning.issuedClientID, "oaiapp_selected_account")
        XCTAssertThrowsError(
            try OAuthCallbackParser.parse(
                URL(string: "http://127.0.0.1:54321/auth/callback?code=one-time-code&state=expected&client_id=oaiapp_other")!,
                expectedState: "expected",
                expectedRedirectURI: redirect,
                expectedClientID: "oaiapp_selected_account"
            )
        ) { error in
            XCTAssertEqual(error as? ChatGPTOAuthError, .registrationMismatch)
        }
    }

    func testCallbackRejectsWrongStateDuplicateParametersAndUnissuedClientID() {
        let redirect = URL(string: "http://127.0.0.1:54321/auth/callback")!
        assertCallbackError(
            "http://127.0.0.1:54321/auth/callback?code=c&state=wrong&client_id=oaiapp_x",
            expectedState: "expected",
            redirect: redirect,
            error: .stateMismatch
        )
        assertCallbackError(
            "http://127.0.0.1:54321/auth/callback?code=c&state=expected&state=expected&client_id=oaiapp_x",
            expectedState: "expected",
            redirect: redirect,
            error: .invalidCallback
        )
        assertCallbackError(
            "http://127.0.0.1:54321/auth/callback?code=c&state=expected&client_id=dynamic_agent_client",
            expectedState: "expected",
            redirect: redirect,
            error: .registrationIncomplete
        )
        assertCallbackError(
            "http://127.0.0.1:54321/wrong?code=c&state=expected&client_id=oaiapp_x",
            expectedState: "expected",
            redirect: redirect,
            error: .invalidCallback
        )
    }

    func testDeniedCallbackStopsBeforeCodeExchange() {
        assertCallbackError(
            "http://127.0.0.1:54321/auth/callback?error=access_denied&state=expected",
            expectedState: "expected",
            redirect: URL(string: "http://127.0.0.1:54321/auth/callback")!,
            error: .accessDenied
        )
    }

    func testDirectPlanPermissionIsReadFromTheGrantedScopeSet() async {
        let noPlan = ChatGPTAccountAccess(
            issuedClientID: "oaiapp_fixture-client",
            subject: "fixture-subject",
            grantedScopes: ["openid", "email", "resource.invoke"],
            accessToken: "transient-test-token"
        )
        XCTAssertFalse(noPlan.hasDirectPlanAccess)

        do {
            _ = try await ChatGPTOAuthClient().listModels(for: noPlan)
            XCTFail("A model request must not be sent without the direct-plan scope.")
        } catch let error as ChatGPTOAuthError {
            XCTAssertEqual(error, .planPermissionMissing)
        } catch {
            XCTFail("Unexpected permission error: \(error)")
        }

        let granted = ChatGPTAccountAccess(
            issuedClientID: "oaiapp_fixture-client",
            subject: "fixture-subject",
            grantedScopes: [ChatGPTOAuthConstants.directPlanScope],
            accessToken: "transient-test-token"
        )
        XCTAssertTrue(granted.hasDirectPlanAccess)
    }

    private func assertCallbackError(
        _ url: String,
        expectedState: String,
        redirect: URL,
        error expected: ChatGPTOAuthError,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertThrowsError(
            try OAuthCallbackParser.parse(
                URL(string: url)!,
                expectedState: expectedState,
                expectedRedirectURI: redirect
            ),
            file: file,
            line: line
        ) { error in
            XCTAssertEqual(error as? ChatGPTOAuthError, expected, file: file, line: line)
        }
    }

    private static func isBase64URLCharacter(_ character: Character) -> Bool {
        character.isASCII && (character.isLetter || character.isNumber || character == "-" || character == "_")
    }
}
