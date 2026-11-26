import CoreFoundation
import Foundation
import Security
import UIKit

/// Local Settings witness only. This never advertises tools, authorizes a call,
/// performs a read of product records, or admits a provider handoff.
struct LiveConversationToolsSettingsWitness: Equatable {
    let backendModel: String
    let credentialEpoch: String
    let generation: String
    let grantID: String
    let voiceGeneration: String

    private static let scope = "selected-live-conversation-local-tools-v3"
    private static let account = "live-conversation-tools-policy"
    private static func service(_ generation: String) -> String {
        "com.orot.mobile.live-conversation-tools-policy.v3." + generation
    }

    /// Only a native caller with the current socket credential can obtain this witness.
    /// The provider and JS tool descriptor never supply policy fields or row contents.
    @MainActor
    static func readCurrent(base: LiveResponsesSettingsGrant, key: String) -> Self? {
        resolve(base: base, key: key, protected: { UIApplication.shared.isProtectedDataAvailable },
                read: RealtimeVoiceCanonicalHealthAdmission.read, policy: readPolicy)
    }

    /// Read the current selected native account without releasing its API key to JavaScript.
    @MainActor
    static func readSelected() -> Self? {
        typealias Store = RealtimeVoiceCanonicalHealthAdmission
        guard UIApplication.shared.isProtectedDataAvailable,
              let credential = Store.read("com.orot.mobile.voice-settings.v1", "voice-settings"),
              let response = credential["effectiveResponsesGeneration"] as? String,
              let key = credential["apiKey"] as? String,
              let candidates = credential["pairCandidates"] as? [[String: Any]], (1 ... 2).contains(candidates.count)
        else { return nil }
        let exact = candidates.compactMap { $0["pair"] as? [String: Any] }.filter { $0["responsesGeneration"] as? String == response }
        guard exact.count == 1, let model = exact.first?["backendModel"] as? String,
              let base = LiveResponsesSettingsGrant(["backendModel": model, "generation": response, "grantID": response + "-model"])
        else { return nil }
        return readCurrent(base: base, key: key)
    }

    var bridgeFields: [String: String] {
        ["backendModel": backendModel, "credentialEpoch": credentialEpoch, "generation": generation,
         "grantID": grantID, "voiceGeneration": voiceGeneration]
    }

    @MainActor
    static func resolve(base: LiveResponsesSettingsGrant, key: String, protected: () -> Bool,
                        read: (String, String) -> [String: Any]?, policy: (String, String) -> [String: String]?) -> Self?
    {
        guard !key.isEmpty, protected(), let first = snapshot(base: base, key: key, read: read, policy: policy), protected(),
              snapshot(base: base, key: key, read: read, policy: policy) == first, protected()
        else { return nil }
        return first
    }

    private static func snapshot(base: LiveResponsesSettingsGrant, key: String,
                                 read: (String, String) -> [String: Any]?, policy: (String, String) -> [String: String]?) -> Self?
    {
        guard let marker = policy(service(base.generation), account),
              let credential = read("com.orot.mobile.voice-settings.v1", "voice-settings"),
              credential["apiKey"] as? String == key,
              credential["effectiveResponsesGeneration"] as? String == base.generation,
              let epoch = credential["credentialEpoch"] as? String, digest(epoch),
              let candidates = credential["pairCandidates"] as? [[String: Any]], (1 ... 2).contains(candidates.count)
        else { return nil }
        let selected = candidates.compactMap { $0["pair"] as? [String: Any] }.filter {
            $0["responsesGeneration"] as? String == base.generation
        }
        guard selected.count == 1, let pair = selected.first, pair.count == 6,
              isVersionOne(pair["version"]), pair["credentialEpoch"] as? String == epoch,
              pair["speechModel"] as? String == "gpt-live-1.1", pair["backendModel"] as? String == base.backendModel,
              let voice = pair["voiceGeneration"] as? String, digest(voice), voice != base.generation,
              active("voice", generation: voice, read: read), active("voice-responses", generation: base.generation, read: read)
        else { return nil }
        let expected = Self(backendModel: base.backendModel, credentialEpoch: epoch, generation: base.generation,
                            grantID: base.grantID, voiceGeneration: voice)
        guard marker == expected.policyFields else { return nil }
        return expected
    }

    private var policyFields: [String: String] {
        ["scope": Self.scope, "providerId": "openai-live-responses", "recipient": "OpenAI Responses (Live)",
         "backendModel": backendModel, "credentialEpoch": credentialEpoch, "generation": generation,
         "grantID": grantID, "voiceGeneration": voiceGeneration]
    }

    private static func active(_ domain: String, generation: String, read: (String, String) -> [String: Any]?) -> Bool {
        guard let row = read("com.orot.mobile.settings-consent-authority.v1." + domain, "settings-consent-authority")
        else { return false }
        return row.count == 3 && isVersionOne(row["version"]) && row["status"] as? String == "active" &&
            row["generation"] as? String == generation
    }

    private static func isVersionOne(_ raw: Any?) -> Bool {
        guard let version = raw as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID() else { return false }
        return version.doubleValue == 1
    }

    private static func digest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48 ... 57).contains($0) || (97 ... 102).contains($0) }
    }

    #if OROT_TESTS && targetEnvironment(simulator)
        /// Same protected Keychain decoder, but a disjoint UUID-owned fixture service.
        static func fixturePolicy(_ namespace: String) -> [String: String]? {
            readPolicy(namespace + ".canonical-synthetic-common-policy", "synthetic-settings-consent")
        }
    #endif

    private static func readPolicy(_ service: String, _ account: String) -> [String: String]? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: account,
            kSecReturnData as String: true, kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne, kSecAttrSynchronizable as String: false,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let row = result as? [String: Any],
              let data = row[kSecValueData as String] as? Data
        else { return nil }
        return decodePolicy(data, accessibility: row[kSecAttrAccessible as String] as? String)
    }

    static func decodePolicy(_ data: Data, accessibility: String?) -> [String: String]? {
        guard accessibility == (kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String), data.count <= 2048
        else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
    }
}
