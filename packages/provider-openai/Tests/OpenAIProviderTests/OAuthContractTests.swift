import Foundation
import JWTKit
import XCTest
@testable import OpenAIProvider

final class OAuthContractTests: XCTestCase {
    private var fixture: IdentityFixture!
    private var jwksData: Data!

    override func setUpWithError() throws {
        let url = Bundle.module.url(forResource: "identity-tokens", withExtension: "json")!
        let source = try Data(contentsOf: url)
        fixture = try JSONDecoder().decode(IdentityFixture.self, from: source)
        let document = try JSONSerialization.jsonObject(with: source) as! [String: Any]
        jwksData = try JSONSerialization.data(withJSONObject: document["jwks"]!)
    }

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
            jwksURI: URL(string: "https://auth.openai.com/oauth2/v1/keys")!
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

    func testCallbackAcceptsOnlyMatchingLoopbackStateAndIssuedClientID() throws {
        let callback = try OAuthCallbackParser.parse(
            URL(string: "http://127.0.0.1:54321/auth/callback?code=one-time-code&state=expected&client_id=oaiapp_registered")!,
            expectedState: "expected",
            expectedRedirectURI: URL(string: "http://127.0.0.1:54321/auth/callback")!
        )

        XCTAssertEqual(callback, OAuthCallback(code: "one-time-code", issuedClientID: "oaiapp_registered"))
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

    func testPublishedRS256KeyVerifiesIDTokenAndRequiredClaims() async throws {
        let identity = try await IDTokenVerifier().verify(
            fixture.tokens["valid"]!,
            jwksData: jwksData,
            clientID: "oaiapp_fixture-client",
            nonce: "fixture-nonce",
            now: Date()
        )

        XCTAssertEqual(identity.subject, "fixture-subject")
    }

    func testWrongIssuerAudienceExpiryNonceAndFutureIssuedAtAreRejected() async {
        let claims = ["wrongIssuer", "wrongAudience", "expired", "wrongNonce", "futureIssuedAt"]
        for name in claims {
            await assertIdentityError(fixture.tokens[name]!, error: .invalidIdentity)
        }
    }

    func testSignatureFailureAndNonRS256HeadersAreRejected() async {
        let valid = fixture.tokens["valid"]!
        let parts = valid.split(separator: ".", omittingEmptySubsequences: false)
        let tamperedSignature = String(parts[2].first == "A" ? "B" : "A") + String(parts[2].dropFirst())
        await assertIdentityError("\(parts[0]).\(parts[1]).\(tamperedSignature)", error: .invalidIdentity)
        await assertIdentityError(reheader(valid, algorithm: "none"), error: .invalidIdentity)
        await assertIdentityError(reheader(valid, algorithm: "HS256"), error: .invalidIdentity)
        await assertIdentityError(reheader(valid, algorithm: "RS256", keyID: nil), error: .invalidIdentity)
        await assertIdentityError(reheader(valid, algorithm: "RS256", keyID: "untrusted-key"), error: .invalidIdentity)
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

    private func assertIdentityError(
        _ token: String,
        error expected: ChatGPTOAuthError,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            _ = try await IDTokenVerifier().verify(
                token,
                jwksData: jwksData,
                clientID: "oaiapp_fixture-client",
                nonce: "fixture-nonce",
                now: Date()
            )
            XCTFail("Expected ID-token verification to fail.", file: file, line: line)
        } catch let error as ChatGPTOAuthError {
            XCTAssertEqual(error, expected, file: file, line: line)
        } catch {
            XCTFail("Unexpected ID-token error: \(error)", file: file, line: line)
        }
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

    private func reheader(_ token: String, algorithm: String, keyID: String? = "unit-test-key") -> String {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        var header = ["alg": algorithm, "typ": "JWT"]
        if let keyID { header["kid"] = keyID }
        let data = try! JSONSerialization.data(withJSONObject: header, options: [.sortedKeys])
        return "\(data.base64URLEncodedString()).\(parts[1]).\(parts[2])"
    }

    private static func isBase64URLCharacter(_ character: Character) -> Bool {
        character.isASCII && (character.isLetter || character.isNumber || character == "-" || character == "_")
    }
}

private struct IdentityFixture: Decodable {
    let jwks: JWKS
    let tokens: [String: String]
}
