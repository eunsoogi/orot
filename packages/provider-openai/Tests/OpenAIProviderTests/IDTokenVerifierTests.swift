import Foundation
import JWTKit
import XCTest
@testable import OpenAIProvider

final class IDTokenVerifierTests: XCTestCase {
    private var fixture: IdentityFixture!
    private var jwksData: Data!

    override func setUpWithError() throws {
        let url = Bundle.module.url(forResource: "identity-tokens", withExtension: "json")!
        let source = try Data(contentsOf: url)
        fixture = try JSONDecoder().decode(IdentityFixture.self, from: source)
        let document = try JSONSerialization.jsonObject(with: source) as! [String: Any]
        jwksData = try JSONSerialization.data(withJSONObject: document["jwks"]!)
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

    private func reheader(_ token: String, algorithm: String, keyID: String? = "unit-test-key") -> String {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        var header = ["alg": algorithm, "typ": "JWT"]
        if let keyID { header["kid"] = keyID }
        let data = try! JSONSerialization.data(withJSONObject: header, options: [.sortedKeys])
        return "\(data.base64URLEncodedString()).\(parts[1]).\(parts[2])"
    }
}

private struct IdentityFixture: Decodable {
    let jwks: JWKS
    let tokens: [String: String]
}
