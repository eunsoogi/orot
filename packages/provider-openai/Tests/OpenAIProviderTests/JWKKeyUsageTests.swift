import Foundation
import XCTest
@testable import OpenAIProvider

final class JWKKeyUsageTests: XCTestCase {
    func testJWKSKeysMustPermitSignatureVerification() async throws {
        let encryptionUse = try fixtureJWKS(use: "enc")
        let encryptionOnlyOperations = try fixtureJWKS(keyOperations: ["encrypt"])

        for jwksData in [encryptionUse.data, encryptionOnlyOperations.data] {
            do {
                _ = try await IDTokenVerifier().verify(
                    encryptionUse.token,
                    jwksData: jwksData,
                    clientID: "oaiapp_fixture-client",
                    nonce: "fixture-nonce",
                    now: Date()
                )
                XCTFail("An encryption-only JWK must not verify an ID token.")
            } catch let error as ChatGPTOAuthError {
                XCTAssertEqual(error, .invalidIdentity)
            } catch {
                XCTFail("Unexpected JWKS key-usage error: \(error)")
            }
        }
    }

    private func fixtureJWKS(
        use: String? = nil,
        keyOperations: [String]? = nil
    ) throws -> (data: Data, token: String) {
        let url = Bundle.module.url(forResource: "identity-tokens", withExtension: "json")!
        let source = try Data(contentsOf: url)
        var document = try JSONSerialization.jsonObject(with: source) as! [String: Any]
        var jwks = document["jwks"] as! [String: Any]
        var keys = jwks["keys"] as! [[String: Any]]

        if let use { keys[0]["use"] = use }
        if let keyOperations { keys[0]["key_ops"] = keyOperations }
        jwks["keys"] = keys
        document["jwks"] = jwks

        let fixture = try JSONDecoder().decode(IdentityFixture.self, from: JSONSerialization.data(withJSONObject: document))
        return (try JSONSerialization.data(withJSONObject: jwks), fixture.tokens["valid"]!)
    }
}

private struct IdentityFixture: Decodable {
    let tokens: [String: String]
}
