#if OROT_TESTS
#import <React/RCTBridgeModule.h>

// This opt-in observation module exports no input mutation or content endpoint.
@interface RCT_EXTERN_MODULE (OrotEncounterInputObservation, NSObject)
RCT_EXTERN_METHOD(record : (NSString *)event sequence : (nonnull NSNumber *)
                      sequence length : (nonnull NSNumber *)length)
@end
#endif
