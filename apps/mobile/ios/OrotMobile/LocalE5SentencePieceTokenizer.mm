#import "LocalE5SentencePieceTokenizer.h"

@import sentencepiece;

#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace {

// Keep SentencePiece's C++ API behind a small Objective-C boundary that Swift can call.
struct TokenizerBox {
    sentencepiece::SentencePieceProcessor processor;
};

NSError *TokenizerError(NSInteger code, NSString *message) {
    return [NSError errorWithDomain:@"OrotSentencePieceTokenizer"
                               code:code
                           userInfo:@{NSLocalizedDescriptionKey : message}];
}

NSString *StringFromStatusMessage(std::string_view message) {
    const std::string ownedMessage(message);
    return [NSString stringWithUTF8String:ownedMessage.c_str()]
               ?: @"SentencePiece reported an error.";
}

} // namespace

@interface OrotSentencePieceTokenizer () {
    void *_tokenizer;
}
@end

@implementation OrotSentencePieceTokenizer

- (nullable instancetype)initWithModelPath:(NSString *)modelPath error:(NSError **)error {
    self = [super init];
    if (!self)
        return nil;

    auto *box = new TokenizerBox();
    const std::string path(modelPath.UTF8String ?: "");
    const auto status = box->processor.Load(path);
    if (!status.ok()) {
        if (error)
            *error = TokenizerError(1, StringFromStatusMessage(status.message()));
        delete box;
        return nil;
    }

    _tokenizer = box;
    return self;
}

- (nullable NSArray<NSNumber *> *)encode:(NSString *)text error:(NSError **)error {
    auto *box = static_cast<TokenizerBox *>(_tokenizer);
    if (!box) {
        if (error)
            *error = TokenizerError(2, @"The SentencePiece model is not loaded.");
        return nil;
    }

    const std::string input(text.UTF8String ?: "");
    std::vector<int> ids;
    const auto status = box->processor.Encode(input, &ids);
    if (!status.ok()) {
        if (error)
            *error = TokenizerError(3, StringFromStatusMessage(status.message()));
        return nil;
    }

    NSMutableArray<NSNumber *> *result = [NSMutableArray arrayWithCapacity:ids.size()];
    for (const int identifier : ids)
        [result addObject:@(identifier)];
    return result;
}

- (void)dealloc {
    delete static_cast<TokenizerBox *>(_tokenizer);
}

@end
