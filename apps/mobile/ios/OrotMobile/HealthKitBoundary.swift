import Foundation
import HealthKit

/// Maps named Orot features to narrow HealthKit types while keeping read grants unobservable.
enum HealthKitBoundary {
    enum AnchorError: Error {
        case invalid
    }

    struct SampleRequest {
        let feature: String
        let sampleKind: String
        let startDate: Date
        let endDate: Date
        let limit: Int
    }

    struct AuthorizationPlan {
        let shareTypes: Set<HKSampleType>
        let readTypes: Set<HKObjectType>
    }

    static func decodeSampleQuery(_ raw: NSDictionary) -> SampleRequest? {
        guard let value = raw as? [String: Any],
              let feature = value["feature"] as? String,
              let kind = value["sampleKind"] as? String,
              let start = date(value["startDate"]), let end = date(value["endDate"]),
              let number = value["limit"] as? NSNumber else { return nil }
        let limit = number.intValue
        guard number.doubleValue == Double(limit), (1 ... 500).contains(limit), start <= end,
              isValidSampleKind(kind, for: feature) else { return nil }
        return SampleRequest(feature: feature, sampleKind: kind, startDate: start, endDate: end, limit: limit)
    }

    private static func date(_ value: Any?) -> Date? {
        guard let raw = value as? String else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    }

    static func isSupported(_ feature: String) -> Bool {
        guard ["medications", "bloodPressure", "sleep", "heartRate", "steps", "bodyMass"].contains(feature) else {
            return false
        }
        if feature == "medications" {
            if #available(iOS 26.0, *) {
                return true
            }
            return false
        }
        return true
    }

    static func readTypes(for feature: String) -> Set<HKObjectType>? {
        switch feature {
        case "medications":
            if #available(iOS 26.0, *) {
                // Definitions and dose events are distinct HealthKit read types.
                return [HKObjectType.userAnnotatedMedicationType(), HKObjectType.medicationDoseEventType()]
            }
            return nil
        case "bloodPressure":
            guard let systolic = HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic),
                  let diastolic = HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic) else { return nil }
            // iOS 27 Simulator throws if a blood-pressure correlation is in this read-authorization set.
            return [systolic, diastolic]
        case "sleep":
            return HKObjectType.categoryType(forIdentifier: .sleepAnalysis).map { Set<HKObjectType>([$0]) }
        case "heartRate":
            return HKObjectType.quantityType(forIdentifier: .heartRate).map { Set<HKObjectType>([$0]) }
        case "steps":
            return HKObjectType.quantityType(forIdentifier: .stepCount).map { Set<HKObjectType>([$0]) }
        case "bodyMass":
            return HKObjectType.quantityType(forIdentifier: .bodyMass).map { Set<HKObjectType>([$0]) }
        default:
            return nil
        }
    }

    static func authorizationPlan(for feature: String) -> AuthorizationPlan? {
        guard let readTypes = readTypes(for: feature) else { return nil }
        // This boundary only reads HealthKit; it never asks to share samples back.
        return AuthorizationPlan(shareTypes: [], readTypes: readTypes)
    }

    static func isValidSampleKind(_ kind: String, for feature: String) -> Bool {
        switch (feature, kind) {
        case ("medications", "medicationDoseEvents"), ("bloodPressure", "bloodPressure"),
             ("sleep", "sleep"), ("heartRate", "heartRate"), ("steps", "steps"),
             ("bodyMass", "bodyMass"):
            true
        default:
            false
        }
    }

    static func sampleType(feature: String, kind: String) -> HKSampleType? {
        guard isValidSampleKind(kind, for: feature) else { return nil }
        switch feature {
        case "medications":
            if #available(iOS 26.0, *) {
                return HKObjectType.medicationDoseEventType()
            }
            return nil
        case "bloodPressure":
            return HKObjectType.correlationType(forIdentifier: .bloodPressure)
        case "sleep":
            return HKObjectType.categoryType(forIdentifier: .sleepAnalysis)
        case "heartRate":
            return HKObjectType.quantityType(forIdentifier: .heartRate)
        case "steps":
            return HKObjectType.quantityType(forIdentifier: .stepCount)
        case "bodyMass":
            return HKObjectType.quantityType(forIdentifier: .bodyMass)
        default:
            return nil
        }
    }

    static func snapshot(_ sample: HKSample) throws -> [String: Any] {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var result: [String: Any] = [
            "id": sample.uuid.uuidString,
            "typeIdentifier": sample.sampleType.identifier,
            "startDate": formatter.string(from: sample.startDate),
            "endDate": formatter.string(from: sample.endDate),
            "sourceIdentifier": sample.sourceRevision.source.bundleIdentifier,
            "sourceName": sample.sourceRevision.source.name,
        ]
        if let version = sample.sourceRevision.version {
            result["sourceVersion"] = version
        }
        if let productType = sample.sourceRevision.productType {
            result["sourceProductType"] = productType
        }
        if let device = sample.device {
            var deviceSnapshot: [String: String] = [:]
            if let value = device.manufacturer {
                deviceSnapshot["manufacturer"] = value
            }
            if let value = device.model {
                deviceSnapshot["model"] = value
            }
            if let value = device.hardwareVersion {
                deviceSnapshot["hardwareVersion"] = value
            }
            if let value = device.softwareVersion {
                deviceSnapshot["softwareVersion"] = value
            }
            if !deviceSnapshot.isEmpty {
                result["device"] = deviceSnapshot
            }
        }
        if let quantity = sample as? HKQuantitySample {
            let unit = Self.unit(for: quantity.quantityType.identifier)
            result["value"] = quantity.quantity.doubleValue(for: unit)
            result["unit"] = unit.unitString
            // The query uses a canonical unit because HealthKit omits each entry's display unit.
            result["sourceRepresentation"] = [
                "status": "unavailable",
                "reason": "healthkit_does_not_expose_original_display_unit",
            ]
        }
        if let category = sample as? HKCategorySample {
            result["categoryValue"] = category.value
        }
        if let correlation = sample as? HKCorrelation {
            result["components"] = try correlation.objects.map(Self.snapshot)
        }
        if #available(iOS 26.0, *), let dose = sample as? HKMedicationDoseEvent {
            result["medicationConceptIdentifier"] = try Self.encodedIdentifier(dose.medicationConceptIdentifier)
            if let scheduledDate = dose.scheduledDate {
                result["scheduledDate"] = formatter.string(from: scheduledDate)
            }
            if let quantity = dose.doseQuantity {
                result["doseQuantity"] = quantity
            }
            result["doseUnit"] = dose.unit.unitString
            result["doseStatus"] = dose.logStatus.rawValue
            result["doseStatusName"] = Self.doseStatusName(dose.logStatus.rawValue)
            result["scheduleType"] = dose.scheduleType.rawValue
            result["scheduleTypeName"] = Self.scheduleTypeName(dose.scheduleType.rawValue)
        }
        return result
    }

    private static func unit(for identifier: String) -> HKUnit {
        switch identifier {
        case HKQuantityTypeIdentifier.heartRate.rawValue: HKUnit.count().unitDivided(by: .minute())
        case HKQuantityTypeIdentifier.stepCount.rawValue: .count()
        case HKQuantityTypeIdentifier.bodyMass.rawValue: .gramUnit(with: .kilo)
        case HKQuantityTypeIdentifier.bloodPressureSystolic.rawValue, HKQuantityTypeIdentifier.bloodPressureDiastolic.rawValue:
            .millimeterOfMercury()
        default: .count()
        }
    }

    static func authorizationResult(availability: String, status: String) -> NSDictionary {
        ["availability": availability, "requestStatus": status, "readAuthorization": "notObservable"] as NSDictionary
    }

    static func sampleResult(availability: String, samples: [[String: Any]]?) -> NSDictionary {
        var result: [String: Any] = ["availability": availability, "readAuthorization": "notObservable"]
        if let samples {
            result["status"] = "completed"; result["samples"] = samples
        } else {
            result["status"] = "notRun"
        }
        return result as NSDictionary
    }

    static func medicationResult(availability: String,
                                 medications: [[String: Any]]?,
                                 completeSnapshot: Bool = false) -> NSDictionary
    {
        var result: [String: Any] = ["availability": availability, "readAuthorization": "notObservable"]
        if let medications {
            result["status"] = "completed"
            result["medications"] = medications
            result["completeSnapshot"] = completeSnapshot
        } else {
            result["status"] = "notRun"
        }
        return result as NSDictionary
    }

    static func sampleChangesResult(availability: String,
                                    addedSamples: [[String: Any]]?,
                                    deletedSampleIDs: [String] = [],
                                    cursor: String? = nil,
                                    hasMore: Bool = false) -> NSDictionary
    {
        var result: [String: Any] = ["availability": availability, "readAuthorization": "notObservable"]
        if let addedSamples {
            result["status"] = "completed"
            result["addedSamples"] = addedSamples
            result["deletedSampleIds"] = deletedSampleIDs
            result["cursor"] = cursor as Any? ?? NSNull()
            result["hasMore"] = hasMore
        } else {
            result["status"] = "notRun"
        }
        return result as NSDictionary
    }
}
