import Foundation
import HealthKit

/// Builds one read-only request from only the selected, supported feature set.
enum HealthKitBatchAuthorization {
    struct Plan {
        let shareTypes: Set<HKSampleType>
        let readTypes: Set<HKObjectType>
        let perObjectReadTypes: [HKObjectType]
        let requestedFeatures: [String]
        let unsupportedFeatures: [String]
    }

    static func plan(for features: [String]) -> Plan? {
        let knownFeatures = ["medications", "bloodPressure", "sleep", "heartRate", "steps", "bodyMass"]
        guard !features.isEmpty,
              Set(features).count == features.count,
              features.allSatisfy(knownFeatures.contains)
        else { return nil }

        var shareTypes = Set<HKSampleType>()
        var readTypes = Set<HKObjectType>()
        var perObjectReadTypes: [HKObjectType] = []
        var requestedFeatures: [String] = []
        var unsupportedFeatures: [String] = []
        // Keep unsupported selected features visible without blocking supported reads.
        for feature in features {
            guard HealthKitBoundary.isSupported(feature),
                  let featurePlan = HealthKitBoundary.authorizationPlan(for: feature)
            else {
                unsupportedFeatures.append(feature)
                continue
            }
            shareTypes.formUnion(featurePlan.shareTypes)
            readTypes.formUnion(featurePlan.readTypes)
            perObjectReadTypes.append(contentsOf: featurePlan.perObjectReadTypes)
            requestedFeatures.append(feature)
        }
        return Plan(
            shareTypes: shareTypes,
            readTypes: readTypes,
            perObjectReadTypes: perObjectReadTypes,
            requestedFeatures: requestedFeatures,
            unsupportedFeatures: unsupportedFeatures,
        )
    }

    static func result(availability: String,
                       status: String,
                       requestedFeatures: [String],
                       unsupportedFeatures: [String]) -> NSDictionary
    {
        [
            "availability": availability,
            "requestStatus": status,
            "readAuthorization": "notObservable",
            "requestedFeatures": requestedFeatures,
            "unsupportedFeatures": unsupportedFeatures,
        ] as NSDictionary
    }
}

extension HealthKitBoundary {
    struct AuthorizationPlan {
        let shareTypes: Set<HKSampleType>
        let readTypes: Set<HKObjectType>
        let perObjectReadTypes: [HKObjectType]
    }

    static func readTypes(for feature: String) -> Set<HKObjectType>? {
        switch feature {
        case "medications":
            if #available(iOS 26.0, *) {
                // Medication grants apply per object and include its dose events. Neither belongs in a sample authorization request.
                return []
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
        var perObjectReadTypes: [HKObjectType] = []
        if feature == "medications", #available(iOS 26.0, *) {
            perObjectReadTypes = [HKObjectType.userAnnotatedMedicationType()]
        }
        return AuthorizationPlan(shareTypes: [], readTypes: readTypes, perObjectReadTypes: perObjectReadTypes)
    }
}
