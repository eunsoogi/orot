import Foundation

/// Package-owned display resources preserve Korean fallback on every supported platform.
/// Authentication decisions and callback protocol values never depend on these strings.
enum ProviderDisplayCopy {
    static func text(_ key: String) -> String {
        NSLocalizedString(key, tableName: "ProviderDisplayCopy", bundle: .module, comment: "Provider authentication display")
    }
}
