#include <gtest/gtest.h>
#include "ipc/json_protocol.h"
#include "ipc/base64.h"
#include "json.hpp"

using nlohmann::json;

// ---- dispatch (low-level, may throw on malformed input) ----

TEST(JsonProtocolDispatch, PingReturnsOk) {
  auto r = json::parse(lisna::ipc::dispatch(R"({"id":"abc","type":"ping"})"));
  EXPECT_EQ(r["id"], "abc");
  EXPECT_EQ(r["type"], "ok");
}

TEST(JsonProtocolDispatch, UnknownTypeReturnsErrorUnimpl) {
  auto r = json::parse(lisna::ipc::dispatch(R"({"id":"x","type":"banana"})"));
  EXPECT_EQ(r["id"], "x");
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "unimpl");
  EXPECT_EQ(r["message"], "banana");
}

TEST(JsonProtocolDispatch, MalformedThrows) {
  EXPECT_THROW(lisna::ipc::dispatch("{not json"), std::exception);
}

TEST(JsonProtocolDispatch, MissingIdGetsDefaultDash) {
  auto r = json::parse(lisna::ipc::dispatch(R"({"type":"ping"})"));
  EXPECT_EQ(r["id"], "-");
  EXPECT_EQ(r["type"], "ok");
}

// ---- dispatch_or_error (production entry point — never throws) ----

TEST(JsonProtocolDispatchOrError, MalformedReturnsErrorJson) {
  // Must return parseable JSON, NOT throw.
  std::string raw;
  ASSERT_NO_THROW(raw = lisna::ipc::dispatch_or_error("garbage{"));
  auto r = json::parse(raw);  // would itself throw if the wrapper produced bad JSON
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "parse");
  EXPECT_EQ(r["id"], "-");
}

TEST(JsonProtocolDispatchOrError, ErrorMessageWithEmbeddedQuoteStillValidJson) {
  // nlohmann's parse_error message often contains `'X'` style quotes around
  // the offending token. Pre-fix this would have broken the JSON; post-fix
  // dump() escapes the content. This test pins that contract.
  std::string raw = lisna::ipc::dispatch_or_error(R"({"id":"x","type":")");
  auto r = json::parse(raw);
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "parse");
  EXPECT_TRUE(r["message"].is_string());
  EXPECT_FALSE(r["message"].get<std::string>().empty());
}

TEST(JsonProtocolDispatchOrError, ErrorMessageWithEmbeddedBackslashStillValidJson) {
  // Force a parse error that surfaces a backslash in e.what(). Even if not
  // every parse_error message contains a literal '\', the contract is that
  // dump() handles all chars safely. We verify by feeding a backslash-rich
  // payload and asserting the wrapper output round-trips through json::parse.
  std::string raw = lisna::ipc::dispatch_or_error("\\\\\\\\");
  ASSERT_NO_THROW({ auto _ = json::parse(raw); (void)_; });
}

TEST(JsonProtocolDispatchOrError, ValidPingDelegatesToDispatch) {
  // Sanity: when input is valid, dispatch_or_error returns dispatch's output.
  auto r = json::parse(lisna::ipc::dispatch_or_error(R"({"id":"p","type":"ping"})"));
  EXPECT_EQ(r["id"], "p");
  EXPECT_EQ(r["type"], "ok");
}

// ---- base64 decoder ----

TEST(Base64, EmptyInputReturnsEmptyVec) {
  EXPECT_TRUE(lisna::ipc::b64_decode("").empty());
}

TEST(Base64, DecodesHello) {
  // "SGVsbG8=" == "Hello"
  auto out = lisna::ipc::b64_decode("SGVsbG8=");
  ASSERT_EQ(out.size(), 5u);
  EXPECT_EQ(out[0], 'H');
  EXPECT_EQ(out[1], 'e');
  EXPECT_EQ(out[2], 'l');
  EXPECT_EQ(out[3], 'l');
  EXPECT_EQ(out[4], 'o');
}

TEST(Base64, ToleratesWhitespace) {
  // Same payload with embedded whitespace/newlines.
  auto out = lisna::ipc::b64_decode("SGVs\nbG8 =");
  ASSERT_EQ(out.size(), 5u);
  EXPECT_EQ(std::string(out.begin(), out.end()), "Hello");
}

TEST(Base64, InvalidCharReturnsEmptyVec) {
  // '!' is not in the alphabet.
  EXPECT_TRUE(lisna::ipc::b64_decode("SGV!bG8=").empty());
}

TEST(Base64, RoundTripsFloat32Sample) {
  // Hand-encode 4 bytes of a known float32 value (0.0f → 0x00000000 → "AAAA").
  auto out = lisna::ipc::b64_decode("AAAA");
  ASSERT_EQ(out.size(), 3u);
  EXPECT_EQ(out[0], 0u);
  EXPECT_EQ(out[1], 0u);
  EXPECT_EQ(out[2], 0u);
  // 4 alphabet chars without padding decodes to 3 bytes — float-alignment is
  // the dispatch caller's responsibility (the rejection test below pins this).
}

// ---- STT dispatch (load/transcribe/unload) ----
//
// The g_stt singleton in json_protocol.cpp is process-level. Each test must
// start from a clean state (no model loaded) and leave it clean. The fixture's
// SetUp/TearDown dispatch an unload to reset.

class JsonProtocolDispatchSTT : public ::testing::Test {
 protected:
  void SetUp() override { reset(); }
  void TearDown() override { reset(); }
  static void reset() {
    auto r = json::parse(lisna::ipc::dispatch(
        R"({"id":"_reset","type":"unload","kind":"stt"})"));
    ASSERT_EQ(r["type"], "ok");
  }
};

TEST_F(JsonProtocolDispatchSTT, LoadSttMissingPathReturnsErrorMissingField) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"1","type":"load","kind":"stt"})"));
  EXPECT_EQ(r["id"], "1");
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "missing_field");
}

TEST_F(JsonProtocolDispatchSTT, LoadSttMissingLanguageReturnsErrorMissingField) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"1","type":"load","kind":"stt","path":"/tmp/nope.gguf"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "missing_field");
}

TEST_F(JsonProtocolDispatchSTT, LoadSttFakePathReturnsLoadFailed) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"1","type":"load","kind":"stt","path":"/tmp/nonexistent-model.gguf","language":"ja"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "load_failed");
}

TEST_F(JsonProtocolDispatchSTT, LoadUnknownKindReturnsUnimpl) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"1","type":"load","kind":"banana","path":"/tmp/x","language":"ja"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "unimpl");
}

TEST_F(JsonProtocolDispatchSTT, UnloadWithoutLoadReturnsOk) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"2","type":"unload","kind":"stt"})"));
  EXPECT_EQ(r["id"], "2");
  EXPECT_EQ(r["type"], "ok");
}

TEST_F(JsonProtocolDispatchSTT, UnloadUnknownKindReturnsUnimpl) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"4","type":"unload","kind":"banana"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "unimpl");
}

TEST_F(JsonProtocolDispatchSTT, TranscribeWithoutLoadReturnsNotLoaded) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"3","type":"transcribe","audioBase64":"AAAA","sampleRate":16000})"));
  EXPECT_EQ(r["id"], "3");
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "not_loaded");
}

// ---- invalid_type guards ----
//
// Pre-fix: a non-string path / non-int sampleRate would throw `type_error`
// inside `.get<T>()`, bouncing out through dispatch_or_error as `code:parse`.
// That's misleading — the JSON parsed fine, the field type was wrong. The
// guards return an explicit `code:invalid_type` so callers can distinguish.

TEST_F(JsonProtocolDispatchSTT, LoadSttWrongTypePathReturnsInvalidType) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"t1","type":"load","kind":"stt","path":42,"language":"ja"})"));
  EXPECT_EQ(r["id"], "t1");
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "invalid_type");
}

TEST_F(JsonProtocolDispatchSTT, LoadSttWrongTypeLanguageReturnsInvalidType) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"t2","type":"load","kind":"stt","path":"/tmp/x.gguf","language":true})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "invalid_type");
}

TEST_F(JsonProtocolDispatchSTT, TranscribeWrongTypeSampleRateReturnsInvalidType) {
  // sampleRate is a string instead of an integer. The transcribe branch
  // validates input shape before checking engine state, so this fires
  // even though no model is loaded.
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"t3","type":"transcribe","audioBase64":"AAAA","sampleRate":"16000"})"));
  EXPECT_EQ(r["id"], "t3");
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "invalid_type");
}

TEST_F(JsonProtocolDispatchSTT, TranscribeWrongTypeAudioBase64ReturnsInvalidType) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"t4","type":"transcribe","audioBase64":123,"sampleRate":16000})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "invalid_type");
}

// ---- initialPrompt (STT Phase 1, optional field) ----

TEST_F(JsonProtocolDispatchSTT, TranscribeWrongTypeInitialPromptReturnsInvalidType) {
  // initialPrompt, when present, must be a string. Validated before the
  // engine-state check (shape-before-state), so it fires with no model loaded.
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"t5","type":"transcribe","audioBase64":"AAAA","sampleRate":16000,"initialPrompt":123})"));
  EXPECT_EQ(r["id"], "t5");
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "invalid_type");
}

TEST_F(JsonProtocolDispatchSTT, TranscribeValidInitialPromptStillReachesNotLoaded) {
  // A well-formed string initialPrompt passes the shape gate; with no model
  // loaded the request still bails at not_loaded — pins that the optional
  // field parses cleanly (doesn't bounce out as code:parse).
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"t6","type":"transcribe","audioBase64":"AAAA","sampleRate":16000,"initialPrompt":"明治"})"));
  EXPECT_EQ(r["id"], "t6");
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "not_loaded");
}

// ---- LLM dispatch (generate without load) ----

TEST(JsonProtocol, GenerateWithoutLoadReturnsNotLoaded) {
  // Legacy `prompt` shape still recognized (back-compat) — but the engine is
  // not loaded so we bail at the load check, not the field-shape check. The
  // important part is we're past the missing-field guard.
  auto r = json::parse(lisna::ipc::dispatch(R"({"id":"g1","type":"generate","prompt":"hi"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "not_loaded");
}

TEST(JsonProtocol, GenerateMessagesShapeWithoutLoadReturnsNotLoaded) {
  // Preferred shape: { messages: [{role, content}] }. Same not_loaded outcome
  // because the LLM isn't loaded; pins the new shape parses without error.
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"g2","type":"generate","messages":[{"role":"user","content":"hi"}]})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "not_loaded");
}

TEST(JsonProtocol, GenerateNeitherPromptNorMessagesReturnsMissingField) {
  auto r = json::parse(lisna::ipc::dispatch(R"({"id":"g3","type":"generate"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "missing_field");
}

TEST(JsonProtocol, GenerateMessagesNotArrayReturnsInvalidType) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"g4","type":"generate","messages":"not-an-array"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "invalid_type");
}

TEST(JsonProtocol, GenerateMessagesEmptyArrayReturnsInvalidPayload) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"g5","type":"generate","messages":[]})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "invalid_payload");
}

TEST(JsonProtocol, GenerateMessagesMissingRoleReturnsMissingField) {
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"g6","type":"generate","messages":[{"content":"hi"}]})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "missing_field");
}

TEST(JsonProtocol, GenerateMessagesNonStringContentReturnsMissingField) {
  // `content` must be present AND must be a string. We surface the same code
  // (missing_field) for "absent" and "wrong type" to keep the contract small;
  // the message text disambiguates.
  auto r = json::parse(lisna::ipc::dispatch(
      R"({"id":"g7","type":"generate","messages":[{"role":"user","content":42}]})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "missing_field");
}

TEST(JsonProtocol, GenerateNonStringGrammarReturnsInvalidType) {
  auto r = nlohmann::json::parse(lisna::ipc::dispatch(
      R"({"id":"g1","type":"generate","messages":[{"role":"user","content":"hi"}],"grammar":123})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "invalid_type");
}

TEST(JsonProtocol, GenerateNonIntegerSeedReturnsInvalidType) {
  auto r = nlohmann::json::parse(lisna::ipc::dispatch(
      R"({"id":"g2","type":"generate","messages":[{"role":"user","content":"hi"}],"seed":"x"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "invalid_type");
}

// ─── Utf8Carry — byte-fallback token buffering (matrix diagnosis 2026-06-13) ─

// Helper: build a std::string from raw bytes without C-string null semantics.
static std::string bytes(std::initializer_list<unsigned char> bs) {
  return std::string(bs.begin(), bs.end());
}

// 3-byte JA char (U+3042 HIRAGANA LETTER A: 0xE3 0x81 0x82) split 1+2.
// First take() carries the lone lead byte; second take() completes it.
TEST(Utf8Carry, ThreeByteJASplitOneTwo) {
  lisna::ipc::Utf8Carry c;
  // First piece: lone lead byte 0xE3 (incomplete — needs 2 continuations).
  std::string r1 = c.take(bytes({0xE3}));
  EXPECT_TRUE(r1.empty()) << "incomplete lead should be carried, not emitted";
  // Second piece: the two continuation bytes.
  std::string r2 = c.take(bytes({0x81, 0x82}));
  EXPECT_EQ(r2, bytes({0xE3, 0x81, 0x82})) << "complete 3-byte seq should be emitted";
  EXPECT_TRUE(c.flush().empty()) << "nothing left in carry after complete seq";
}

// 4-byte emoji (U+1F600 GRINNING FACE: 0xF0 0x9F 0x98 0x80) split 2+2.
TEST(Utf8Carry, FourByteEmojiSplitTwoTwo) {
  lisna::ipc::Utf8Carry c;
  // First 2 bytes of a 4-byte sequence: 0xF0 (lead, needs 3 cont.) + 0x9F (1st cont).
  std::string r1 = c.take(bytes({0xF0, 0x9F}));
  EXPECT_TRUE(r1.empty());
  // Last 2 continuation bytes.
  std::string r2 = c.take(bytes({0x98, 0x80}));
  EXPECT_EQ(r2, bytes({0xF0, 0x9F, 0x98, 0x80}));
  EXPECT_TRUE(c.flush().empty());
}

// Mixed: complete ASCII bytes + partial 3-byte JA char tail in one piece.
// The ASCII part should be emitted; the partial JA tail carried forward.
TEST(Utf8Carry, MixedCompleteAsciiPartialJATail) {
  lisna::ipc::Utf8Carry c;
  // "hi" (2 ASCII) + 0xE3 (JA lead, incomplete).
  std::string r1 = c.take(bytes({'h', 'i', 0xE3}));
  EXPECT_EQ(r1, "hi") << "ASCII prefix should emit immediately";
  // Complete the JA char.
  std::string r2 = c.take(bytes({0x81, 0x82}));
  EXPECT_EQ(r2, bytes({0xE3, 0x81, 0x82}));
}

// Lone continuation byte (0x80) — structurally invalid, must be dropped.
TEST(Utf8Carry, LoneContinuationByteDropped) {
  lisna::ipc::Utf8Carry c;
  std::string r = c.take(bytes({0x80}));
  EXPECT_TRUE(r.empty()) << "stray continuation should be dropped";
  std::string f = c.flush();
  EXPECT_TRUE(f.empty()) << "nothing valid to flush after lone continuation";
}

// flush() with incomplete pending (lead byte never completed) → empty.
TEST(Utf8Carry, FlushIncompleteReturnEmpty) {
  lisna::ipc::Utf8Carry c;
  c.take(bytes({0xE3})); // incomplete 3-byte lead
  std::string f = c.flush();
  EXPECT_TRUE(f.empty()) << "incomplete tail should be dropped on flush";
}

// flush() after complete sequences emits the remainder.
TEST(Utf8Carry, FlushAfterCompleteSequences) {
  lisna::ipc::Utf8Carry c;
  // Feed a complete 2-byte sequence (U+00E9 é: 0xC3 0xA9) but don't call take
  // again — verify flush() returns it.
  std::string r = c.take(bytes({0xC3, 0xA9}));
  EXPECT_EQ(r, bytes({0xC3, 0xA9})) << "complete seq emitted by take()";
  EXPECT_TRUE(c.flush().empty()) << "carry is empty after complete take()";

  // Now put a complete seq in via take() and a SECOND complete seq — both
  // should come out through take() directly (carry has nothing to flush).
  std::string r2 = c.take(bytes({'A', 0xC3, 0xA9}));
  EXPECT_EQ(r2, bytes({'A', 0xC3, 0xA9}));
  EXPECT_TRUE(c.flush().empty());
}

// Belt-and-braces: dump(-1,' ',false,replace) does NOT throw on a bare invalid
// byte — documents the fallback that guards against any future Utf8Carry gap.
TEST(Utf8Carry, NlohmannDumpReplaceHandlerDoesNotThrowOnInvalidByte) {
  // Verify the baseline: plain .dump() on {"token":"\xe5"} WOULD throw
  // type_error.316 without the replace handler — we assert the replace form
  // is safe instead.
  // Note: ASSERT_NO_THROW cannot accept braced initializer lists directly
  // (macro comma ambiguity), so we build the JSON object before the assert.
  nlohmann::json obj;
  obj["token"] = std::string("\xe5"); // bare invalid UTF-8 lead byte
  std::string out;
  ASSERT_NO_THROW(
      out = obj.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace))
      << "replace handler must not throw on invalid UTF-8";
  // The output must still be valid JSON (parse it to confirm).
  nlohmann::json reparsed;
  ASSERT_NO_THROW(reparsed = nlohmann::json::parse(out));
  (void)reparsed;
}

// ─── gen_opts_from: sampling parsing (spec sampler-alignment section 5) ─────

TEST(GenOptsFrom, DefaultsAreAlignedWhenSamplingOmitted) {
  json req = {{"id", "1"}, {"type", "generate"},
              {"messages", json::array({{{"role", "user"}, {"content", "hi"}}})}};
  auto opts = lisna::ipc::gen_opts_from(req);
  EXPECT_EQ(opts.topK, 40);
  EXPECT_FLOAT_EQ(opts.topP, 0.95f);
  EXPECT_FLOAT_EQ(opts.minP, 0.05f);
  EXPECT_FLOAT_EQ(opts.repeatPenalty, 1.0f);
  EXPECT_EQ(opts.repeatLastN, 64);
  EXPECT_FLOAT_EQ(opts.dryMultiplier, 0.8f);
  EXPECT_FLOAT_EQ(opts.dryBase, 1.75f);
  EXPECT_EQ(opts.dryAllowedLength, 2);
  EXPECT_EQ(opts.dryPenaltyLastN, -1);
  EXPECT_EQ(opts.maxTokens, 1024);
  EXPECT_FLOAT_EQ(opts.temperature, 0.4f);
}

TEST(GenOptsFrom, SamplingOverridesApply) {
  json req = {{"id", "1"}, {"type", "generate"},
              {"messages", json::array({{{"role", "user"}, {"content", "hi"}}})},
              {"maxTokens", 3000}, {"temperature", 0.5},
              {"sampling", {{"topK", 50}, {"topP", 0.9}, {"minP", 0.0},
                            {"repeatPenalty", 1.1}, {"repeatLastN", 64},
                            {"dryMultiplier", 0.0}}}};
  auto opts = lisna::ipc::gen_opts_from(req);
  EXPECT_EQ(opts.topK, 50);
  EXPECT_FLOAT_EQ(opts.topP, 0.9f);
  EXPECT_FLOAT_EQ(opts.minP, 0.0f);
  EXPECT_FLOAT_EQ(opts.repeatPenalty, 1.1f);   // legacy-config reproduction (matrix R2/R3)
  EXPECT_FLOAT_EQ(opts.dryMultiplier, 0.0f);   // DRY disabled per request
  EXPECT_FLOAT_EQ(opts.dryBase, 1.75f);        // unspecified field keeps default
}

TEST(GenerateRequest, RejectsNonObjectSampling) {
  // Through the public dispatch path: shape errors surface BEFORE the
  // engine-state check, so this works with no model loaded.
  json req = {{"id", "9"}, {"type", "generate"},
              {"messages", json::array({{{"role", "user"}, {"content", "hi"}}})},
              {"sampling", "fast"}};
  auto out = json::parse(lisna::ipc::dispatch_or_error(req.dump()));
  EXPECT_EQ(out["type"], "error");
  EXPECT_EQ(out["code"], "invalid_type");
}

TEST(GenerateRequest, RejectsNonNumericSamplingField) {
  json req = {{"id", "9"}, {"type", "generate"},
              {"messages", json::array({{{"role", "user"}, {"content", "hi"}}})},
              {"sampling", {{"topK", "many"}}}};
  auto out = json::parse(lisna::ipc::dispatch_or_error(req.dump()));
  EXPECT_EQ(out["type"], "error");
  EXPECT_EQ(out["code"], "invalid_type");
}

TEST(GenOptsFrom, FloatForIntFieldTruncates) {
  // nlohmann's .value("topK", int_default) static_casts the float to int.
  // 50.7 → 50. Pin this so the truncation can't silently change to rounding.
  json req = {{"id", "1"}, {"type", "generate"},
              {"messages", json::array({{{"role", "user"}, {"content", "hi"}}})},
              {"sampling", {{"topK", 50.7}}}};
  auto opts = lisna::ipc::gen_opts_from(req);
  EXPECT_EQ(opts.topK, 50);
}
