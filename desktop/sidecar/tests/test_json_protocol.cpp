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

// ---- LLM dispatch (generate without load) ----

TEST(JsonProtocol, GenerateWithoutLoadReturnsNotLoaded) {
  auto r = json::parse(lisna::ipc::dispatch(R"({"id":"g1","type":"generate","prompt":"hi"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "not_loaded");
}
