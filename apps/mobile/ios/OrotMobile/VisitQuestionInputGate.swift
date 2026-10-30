#if OROT_TESTS
    import Foundation

    /// Require the exact synthetic visit-question route and a separate diagnostic run UUID.
    enum VisitQuestionInputGate {
        static let key = "OROT_TEST_VISIT_QUESTION_INPUT_OBSERVATION"

        static func session(defaults: UserDefaults = .standard) -> UUID? {
            guard
                defaults.string(forKey: "OROT_TEST_FORM_OBSERVATION").flatMap(UUID.init(uuidString:)) == nil,
                defaults.string(forKey: "OROT_TEST_ENCOUNTER_INPUT_OBSERVATION").flatMap(UUID.init(uuidString:)) == nil,
                defaults.string(forKey: "OROT_TEST_SCENARIO") == "ai-feature-visit-questions",
                defaults.string(forKey: "OROT_EVIDENCE_SOURCE_DUO_VISUAL_STATE") == "synthetic"
            else {
                return nil
            }
            return defaults.string(forKey: key).flatMap(UUID.init(uuidString:))
        }
    }
#endif
