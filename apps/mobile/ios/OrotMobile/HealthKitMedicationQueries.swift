import Foundation
import HealthKit
import React

public extension HealthKitModule {
    @objc(queryMedicationDefinitions:resolver:rejecter:)
    func queryMedicationDefinitions(_ rawLimit: NSNumber,
                                    resolver resolve: @escaping RCTPromiseResolveBlock,
                                    rejecter reject: @escaping RCTPromiseRejectBlock)
    {
        let limit = rawLimit.intValue
        guard rawLimit.doubleValue == Double(limit), (0 ... 500).contains(limit) else {
            reject("INVALID_LIMIT", "Medication query limit must be zero or between 1 and 500.", nil)
            return
        }
        guard HealthKitBoundary.isSupported("medications") else {
            resolve(HealthKitBoundary.medicationResult(availability: "unsupportedFeature", medications: nil))
            return
        }
        #if DEBUG && targetEnvironment(simulator)
            if hasSyntheticFixture(for: "medications") {
                let complete = limit == 0 || HealthKitSimulatorFixture.medications.count < limit
                resolve(HealthKitBoundary.medicationResult(
                    availability: "available",
                    medications: HealthKitSimulatorFixture.medications,
                    completeSnapshot: complete,
                ))
                return
            }
        #endif
        guard HKHealthStore.isHealthDataAvailable() else {
            resolve(HealthKitBoundary.medicationResult(availability: "unavailable", medications: nil))
            return
        }
        guard #available(iOS 26.0, *) else {
            resolve(HealthKitBoundary.medicationResult(availability: "unsupportedFeature", medications: nil))
            return
        }

        let queryLimit = limit == 0 ? HKObjectQueryNoLimit : limit
        var medications: [[String: Any]] = []
        var finished = false
        let query = HKUserAnnotatedMedicationQuery(predicate: nil, limit: queryLimit) { _, medication, done, error in
            guard !finished else { return }
            if let error {
                finished = true
                reject("HEALTHKIT_QUERY_FAILED", error.localizedDescription, error as NSError)
                return
            }
            do {
                if let medication {
                    try medications.append(HealthKitBoundary.medicationSnapshot(medication))
                }
                if done {
                    finished = true
                    let complete = limit == 0 || medications.count < limit
                    resolve(HealthKitBoundary.medicationResult(
                        availability: "available",
                        medications: medications,
                        completeSnapshot: complete,
                    ))
                }
            } catch {
                finished = true
                reject("HEALTHKIT_SERIALIZATION_FAILED", error.localizedDescription, error as NSError)
            }
        }
        store.execute(query)
    }
}

extension HealthKitBoundary {
    @available(iOS 26.0, *)
    static func medicationSnapshot(_ medication: HKUserAnnotatedMedication) throws -> [String: Any] {
        var result: [String: Any] = try [
            "conceptIdentifier": encodedIdentifier(medication.medication.identifier),
            "displayText": medication.medication.displayText,
            "generalForm": medication.medication.generalForm.rawValue,
            "isArchived": medication.isArchived,
            "hasSchedule": medication.hasSchedule,
        ]
        if let nickname = medication.nickname {
            result["nickname"] = nickname
        }
        return result
    }

    @available(iOS 26.0, *)
    static func encodedIdentifier(_ identifier: HKHealthConceptIdentifier) throws -> String {
        let data = try NSKeyedArchiver.archivedData(withRootObject: identifier, requiringSecureCoding: true)
        return data.base64EncodedString()
    }

    static func doseStatusName(_ rawValue: Int) -> String {
        switch rawValue {
        case 1: "notInteracted"
        case 2: "notificationNotSent"
        case 3: "snoozed"
        case 4: "taken"
        case 5: "skipped"
        case 6: "notLogged"
        default: "unknown"
        }
    }

    static func scheduleTypeName(_ rawValue: Int) -> String {
        switch rawValue {
        case 1: "asNeeded"
        case 2: "schedule"
        default: "unknown"
        }
    }
}
