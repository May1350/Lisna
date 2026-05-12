#include <gtest/gtest.h>
#include "ipc/json_protocol.h"
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
