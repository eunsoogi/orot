import Foundation
import JWTKit

struct VerifiedIdentity: Equatable, Sendable {
    let subject: String
}

struct IDTokenVerifier {
    func verify(
        _ idToken: String,
        jwksData: Data,
        clientID: String,
        nonce: String,
        now: Date
    ) async throws -> VerifiedIdentity {
        guard idToken.utf8.count <= 65_536,
              let parsed = try? DefaultJWTParser().parse(Data(idToken.utf8), as: ChatGPTIDTokenPayload.self),
              parsed.header.alg == "RS256",
              let kid = parsed.header.kid,
              !kid.isEmpty,
              parsed.header.crit?.isEmpty != false,
              parsed.header.jwk == nil,
              parsed.header.jku == nil,
              parsed.header.x5u == nil else {
            throw ChatGPTOAuthError.invalidIdentity
        }

        let decoder = JSONDecoder()
        guard let jwks = try? decoder.decode(JWKS.self, from: jwksData),
              let keyMetadata = try? decoder.decode(JWKKeyMetadataSet.self, from: jwksData),
              keyMetadata.keys.count == jwks.keys.count else {
            throw ChatGPTOAuthError.discoveryUnavailable
        }
        let rsaKeys = jwks.keys.enumerated().compactMap { index, key -> JWK? in
            let metadata = keyMetadata.keys[index]
            let permitsSignatureUse = metadata.use == nil || metadata.use == "sig"
            let permitsVerification = metadata.keyOperations?.contains("verify") ?? true
            guard permitsSignatureUse,
                  permitsVerification,
                  key.keyType == .rsa,
                  key.algorithm == .rs256,
                  key.keyIdentifier != nil,
                  key.modulus != nil,
                  key.exponent != nil else {
                return nil
            }
            return key
        }
        let keyIDs = rsaKeys.compactMap { $0.keyIdentifier?.string }
        guard !rsaKeys.isEmpty,
              Set(keyIDs).count == keyIDs.count,
              keyIDs.contains(kid) else {
            throw ChatGPTOAuthError.invalidIdentity
        }

        let keys: JWTKeyCollection
        do {
            keys = try await JWTKeyCollection().add(jwks: JWKS(keys: rsaKeys))
        } catch {
            throw ChatGPTOAuthError.invalidIdentity
        }

        let payload: ChatGPTIDTokenPayload
        do {
            payload = try await keys.verify(idToken, as: ChatGPTIDTokenPayload.self)
        } catch {
            throw ChatGPTOAuthError.invalidIdentity
        }

        guard payload.issuer.value == ChatGPTOAuthConstants.issuer,
              !payload.subject.value.isEmpty,
              payload.audience.value.contains(clientID),
              payload.nonce == nonce,
              payload.authorizedParty == nil || payload.authorizedParty == clientID,
              payload.audience.value.count <= 1 || payload.authorizedParty == clientID,
              payload.issuedAt.value <= now.addingTimeInterval(60) else {
            throw ChatGPTOAuthError.invalidIdentity
        }
        do {
            try payload.expiration.verifyNotExpired(currentDate: now.addingTimeInterval(-5))
        } catch {
            throw ChatGPTOAuthError.invalidIdentity
        }

        return VerifiedIdentity(subject: payload.subject.value)
    }
}

private struct JWKKeyMetadataSet: Decodable {
    let keys: [Key]

    struct Key: Decodable {
        let use: String?
        let keyOperations: [String]?

        enum CodingKeys: String, CodingKey {
            case use
            case keyOperations = "key_ops"
        }
    }
}

struct ChatGPTIDTokenPayload: JWTPayload, Equatable {
    let issuer: IssuerClaim
    let subject: SubjectClaim
    let audience: AudienceClaim
    let expiration: ExpirationClaim
    let issuedAt: IssuedAtClaim
    let nonce: String
    let authorizedParty: String?

    enum CodingKeys: String, CodingKey {
        case issuer = "iss"
        case subject = "sub"
        case audience = "aud"
        case expiration = "exp"
        case issuedAt = "iat"
        case nonce
        case authorizedParty = "azp"
    }

    func verify(using algorithm: some JWTAlgorithm) async throws {
        guard algorithm.name == "RS256",
              issuer.value == ChatGPTOAuthConstants.issuer,
              !subject.value.isEmpty else {
            throw ChatGPTOAuthError.invalidIdentity
        }
    }
}
