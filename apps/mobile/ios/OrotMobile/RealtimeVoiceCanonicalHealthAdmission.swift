import CoreFoundation
import Foundation
import Security

/// Versioned companion to the existing model/account grant. It cannot grant
/// microphone access, actions, other tools, or transmission by itself.
struct RealtimeVoiceCanonicalHealthAdmission: Equatable {
    /// One native authority for both the exported capability and bridge admission.
    /// A JS-supplied option cannot activate this staged foundation.
    static let enabledForLiveBridge = false

    static func permitsStartupOptions(_ options: NSDictionary, enabled: Bool = enabledForLiveBridge) -> Bool {
        enabled || (options["canonicalHealthGrant"] == nil && options["canonicalHealthDeclaration"] == nil)
    }

    static let name = "local-health-context"
    static let policy = "canonical-health-context-result-v2"
    static let resultLimit = 8192
    let grantID: String
    let generation: String
    let legacyGeneration: String
    let credentialEpoch: String
    let backendModel: String

    init?(_ value: Any) {
        guard let fields = value as? [String: Any],
              Set(fields.keys) == ["version", "capability", "grantID", "generation", "legacyGeneration", "credentialEpoch", "backendModel"],
              let number = fields["version"] as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue == 2,
              fields["capability"] as? String == Self.policy,
              let generation = fields["generation"] as? String, Self.digest(generation),
              let legacy = fields["legacyGeneration"] as? String, Self.digest(legacy), legacy != generation,
              let credential = fields["credentialEpoch"] as? String, Self.digest(credential),
              let model = fields["backendModel"] as? String, ["gpt-6-luna", "gpt-6-sol"].contains(model),
              let grant = fields["grantID"] as? String, grant == generation + "-model"
        else { return nil }
        self.generation = generation
        legacyGeneration = legacy
        credentialEpoch = credential
        grantID = grant
        backendModel = model
    }

    /// Keep the existing aggregate witness check in the same native condition.
    /// Calling this with app-provided metadata cannot manufacture the device row.
    func current(
        base: LiveResponsesSettingsGrant,
        key: String,
        read: (String, String) -> [String: Any]? = Self.read,
    ) -> Bool {
        guard base.generation == legacyGeneration,
              base.backendModel == backendModel,
              base.isCurrent(key: key, read: read),
              let row = read("com.orot.mobile.live-health-context.v2", "live-health-context"),
              Self(row) == self,
              let authority = read("com.orot.mobile.settings-consent-authority.v1.voice-responses-health-context",
                                   "settings-consent-authority"),
              authority.count == 3, authority["version"] as? Int == 1,
              authority["status"] as? String == "active",
              authority["generation"] as? String == generation,
              let credential = read("com.orot.mobile.voice-settings.v1", "voice-settings")
        else { return false }
        guard credential["credentialEpoch"] as? String == credentialEpoch,
              credential["apiKey"] as? String == key, base.isCurrent(key: key, read: read),
              let finalAuthority = read("com.orot.mobile.settings-consent-authority.v1.voice-responses-health-context",
                                        "settings-consent-authority"),
              finalAuthority.count == 3, finalAuthority["version"] as? Int == 1,
              finalAuthority["generation"] as? String == generation,
              finalAuthority["status"] as? String == "active",
              let final = read("com.orot.mobile.live-health-context.v2", "live-health-context")
        else { return false }
        return Self(final) == self
    }

    /// A trusted app-owned canonical descriptor is accepted only from the same
    /// explicit account/capability. The server never supplies configuration.
    func configuration(_ declaration: [String: Any], base: LiveResponsesSettingsGrant, key: String,
                       read: (String, String) -> [String: Any]? = Self.read) -> [String: Any]?
    {
        guard current(base: base, key: key, read: read), declaration.count == 4,
              declaration["name"] as? String == Self.name,
              let text = declaration["description"] as? String, (1 ... 2048).contains(text.utf8.count),
              let strict = declaration["strict"] as? NSNumber, CFGetTypeID(strict) == CFBooleanGetTypeID(), !strict.boolValue,
              let schema = declaration["parameters"] as? [String: Any],
              schema["type"] as? String == "object", schema["additionalProperties"] as? Bool == false,
              let properties = schema["properties"] as? [String: Any],
              Set(properties.keys) == ["days", "topics", "detail", "window"],
              let payload = try? JSONSerialization.data(withJSONObject: declaration), payload.count <= 8192
        else { return nil }
        var tool = declaration
        tool["type"] = "function"
        return ["type": "responses", "responses": ["model": backendModel, "tools": [tool]]]
    }

    /// Native bounds the opaque structured arguments; the exact shared canonical
    /// Conversation parser owns all field semantics before protected application data is read.
    static func boundedArguments(_ raw: String) -> Bool {
        guard (2 ... 1024).contains(raw.utf8.count),
              let object = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any]
        else { return false }
        return Set(object.keys).isSubset(of: ["days", "topics", "detail", "window"])
    }

    static func validResult(_ raw: String) -> Bool {
        guard (1 ... resultLimit).contains(raw.utf8.count),
              let object = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
              object.count == 2, object["tool"] as? String == name,
              let items = object["items"] as? [[String: String]], (1 ... 5).contains(items.count)
        else { return false }
        return Set(items.compactMap { $0["evidenceId"] }).count == items.count && items.allSatisfy {
            $0.count == 3 &&
                ($0["evidenceId"]?.isEmpty == false) &&
                ($0["evidenceRevision"]?.isEmpty == false) &&
                ($0["content"]?.isEmpty == false)
        }
    }

    private static func digest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48 ... 57).contains($0) || (97 ... 102).contains($0) }
    }

    static func read(_ service: String, _ account: String) -> [String: Any]? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: account,
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
            kSecAttrSynchronizable as String: false,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}

/// Main-queue, in-memory ownership for the native per-call review. Neither a
/// bridge field nor a saved Settings grant can mint or serialize a review.
final class CanonicalLiveNativeCallReview {
    struct Scope: Equatable {
        let call: String
        let capability: RealtimeVoiceCanonicalHealthAdmission
    }

    private enum Phase {
        case reviewing(UUID, Scope, started: TimeInterval)
        case approved(Scope, issued: TimeInterval)
    }

    private let now: () -> TimeInterval
    private var phase: Phase?
    private static let validity: TimeInterval = 30

    init(now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.now = now
    }

    /// Only a native presenter should receive this callback. A fresh begin
    /// invalidates an earlier uncompleted review or unclaimed authorization.
    func begin(_ scope: Scope, current: @escaping () -> Bool) -> ((Bool) -> Void)? {
        phase = nil
        guard RealtimeVoiceToolLease.validID(scope.call), current() else { return nil }
        let nonce = UUID()
        phase = .reviewing(nonce, scope, started: now())
        return { [weak self] approved in
            guard let self, case let .reviewing(expected, pending, started)? = phase,
                  nonce == expected, scope == pending
            else { return }
            phase = nil
            guard approved, fresh(since: started), current() else { return }
            phase = .approved(scope, issued: now())
        }
    }

    func consume(_ scope: Scope, current: () -> Bool) -> Bool {
        guard case let .approved(expected, issued)? = phase else { return false }
        phase = nil
        return expected == scope && fresh(since: issued) && current()
    }

    private func fresh(since begin: TimeInterval) -> Bool {
        let elapsed = now() - begin
        return elapsed >= 0 && elapsed < Self.validity
    }

    func retire(_ call: String) {
        switch phase {
        case let .reviewing(_, scope, _)?, let .approved(scope, _)?:
            if scope.call == call {
                phase = nil
            }
        case nil:
            break
        }
    }
}
