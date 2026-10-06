#if DEBUG && targetEnvironment(simulator)
    import Foundation

    /// Supplies in-memory records without writing samples into the HealthKit store.
    enum HealthKitSimulatorFixture {
        static let medications: [[String: Any]] = [[
            "conceptIdentifier": "c3ludGhldGljLW1lZGljYXRpb24=",
            "displayText": "Synthetic medication",
            "generalForm": "tablet",
            "nickname": "Fixture",
            "isArchived": false,
            "hasSchedule": true,
        ]]

        static func sampleChanges(for request: HealthKitSampleChangesRequest) -> NSDictionary {
            let key = "\(request.feature):\(request.sampleKind)"
            let anchor = "\(key):anchor-v1"
            if request.cursor == "\(key):deletion", request.feature == "medications" {
                return HealthKitBoundary.sampleChangesResult(
                    availability: "available",
                    addedSamples: [],
                    deletedSampleIDs: ["synthetic-dose-event"],
                    cursor: "\(key):anchor-v2",
                )
            }
            if request.cursor == anchor {
                return HealthKitBoundary.sampleChangesResult(
                    availability: "available",
                    addedSamples: [],
                    cursor: anchor,
                )
            }

            let start = "2026-10-01T08:00:00.000Z"
            let end = "2026-10-01T08:00:00.000Z"
            let referenceDate = Date()
            // Sleep imports require a positive interval, unlike point-like fixture samples.
            let sampleStartDate = request.feature == "sleep"
                ? referenceDate.addingTimeInterval(-60 * 60)
                : referenceDate
            let sampleRequest = HealthKitBoundary.SampleRequest(
                feature: request.feature,
                sampleKind: request.sampleKind,
                startDate: sampleStartDate,
                endDate: referenceDate,
                limit: request.limit,
            )
            var additions = samples(for: sampleRequest)
            if request.feature == "medications", let doseIndex = additions.firstIndex(where: {
                $0["id"] as? String == "synthetic-dose-event"
            }) {
                additions[doseIndex]["scheduledDate"] = start
                additions[doseIndex]["doseStatusName"] = "taken"
                additions[doseIndex]["doseStatus"] = 4
                additions[doseIndex]["scheduleTypeName"] = "schedule"
                additions[doseIndex]["scheduleType"] = 2
            }
            return HealthKitBoundary.sampleChangesResult(
                availability: "available",
                addedSamples: additions,
                cursor: anchor,
            )
        }

        static func samples(for query: HealthKitBoundary.SampleRequest) -> [[String: Any]] {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let start = formatter.string(from: query.startDate)
            let end = formatter.string(from: query.endDate)
            if query.feature == "bodyMass" {
                return []
            }

            if query.feature == "bloodPressure" {
                let systolic = sample("synthetic-systolic", "HKQuantityTypeIdentifierBloodPressureSystolic", start, end,
                                      value: 120, unit: "mmHg")
                let diastolic = sample("synthetic-diastolic", "HKQuantityTypeIdentifierBloodPressureDiastolic", start, end,
                                       value: 80, unit: "mmHg")
                var correlation = sample("synthetic-blood-pressure", "HKCorrelationTypeIdentifierBloodPressure", start, end)
                correlation["components"] = [systolic, diastolic]
                return [correlation]
            }

            switch query.feature {
            case "medications":
                return [sample("synthetic-dose-event", "HKMedicationDoseEventTypeIdentifierMedicationDoseEvent", start, end,
                               medicationConceptIdentifier: "c3ludGhldGljLW1lZGljYXRpb24=", doseQuantity: 1, doseUnit: "tablet")]
            case "heartRate":
                return [sample("synthetic-heart-rate", "HKQuantityTypeIdentifierHeartRate", start, end,
                               value: 72, unit: "count/min")]
            case "sleep":
                var sleep = sample("synthetic-sleep", "HKCategoryTypeIdentifierSleepAnalysis", start, end)
                sleep["categoryValue"] = 1
                return [sleep]
            case "steps":
                return [sample("synthetic-steps", "HKQuantityTypeIdentifierStepCount", start, end,
                               value: 1200, unit: "count")]
            default:
                return []
            }
        }

        private static func sample(_ id: String, _ type: String, _ start: String, _ end: String,
                                   value: Double? = nil, unit: String? = nil, medicationConceptIdentifier: String? = nil,
                                   doseQuantity: Double? = nil, doseUnit: String? = nil) -> [String: Any]
        {
            var result: [String: Any] = [
                "id": id,
                "typeIdentifier": type,
                "startDate": start,
                "endDate": end,
                "sourceIdentifier": "com.orot.healthkit.synthetic",
                "sourceName": "Synthetic HealthKit probe",
            ]
            if let value {
                result["value"] = value
            }
            if let unit {
                result["unit"] = unit
                result["sourceRepresentation"] = [
                    "status": "unavailable",
                    "reason": "healthkit_does_not_expose_original_display_unit",
                ]
            }
            if let medicationConceptIdentifier {
                result["medicationConceptIdentifier"] = medicationConceptIdentifier
            }
            if let doseQuantity {
                result["doseQuantity"] = doseQuantity
            }
            if let doseUnit {
                result["doseUnit"] = doseUnit
            }
            return result
        }
    }
#endif
