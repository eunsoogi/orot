#if OROT_TESTS
    import Foundation
    import React
    import UIKit

    /// Test-product bridge accepts only fixed event names and bounded scalar lengths, never strings from an editor.
    @objc(OrotEncounterInputObservation)
    final class OrotEncounterInputObservation: NSObject {
        @objc static func requiresMainQueueSetup() -> Bool {
            false
        }

        @objc func constantsToExport() -> [AnyHashable: Any] {
            ["run": EncounterInputGate.session()?.uuidString as Any? ?? NSNull()]
        }

        @objc(record:sequence:length:)
        func record(_ event: String, sequence: NSNumber, length: NSNumber) {
            guard EncounterInputGate.session() != nil,
                  let kind = EncounterInputTrace.ReactEvent(rawValue: event),
                  sequence.doubleValue.isFinite, sequence.doubleValue.rounded() == sequence.doubleValue,
                  length.doubleValue.isFinite, length.doubleValue.rounded() == length.doubleValue,
                  (1 ... 1_000_000).contains(sequence.doubleValue), (0 ... 2000).contains(length.doubleValue)
            else { return }
            let ordinal = sequence.intValue
            let count = length.intValue
            DispatchQueue.main.async {
                let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                    .flatMap(\.windows).compactMap { $0 as? EncounterInputObservationWindow }
                guard windows.count == 1 else { print("OROT_ENCOUNTER_INPUT_UNKNOWN"); return }
                windows[0].react(kind, sequence: ordinal, length: count)
            }
        }
    }
#endif
