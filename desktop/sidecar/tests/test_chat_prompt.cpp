#include <gtest/gtest.h>
#include "llm/chat_prompt.h"

namespace {

std::vector<lisna::llm::ChatMessage> sample_chat() {
  return {
      {"system", "You are helpful."},
      {"user",   "Hello."},
  };
}

// Happy path: a template string containing the LLAMA_3 detection markers
// (`<|start_header_id|>` and `<|end_header_id|>`, per llama-chat.cpp's
// `llm_chat_detect_template`) routes through the LLAMA_3 branch of
// `llama_chat_apply_template`. The function must return applied=true and a
// template-formatted output.
TEST(ChatPrompt, Llama3MarkersTriggerAppliedHappyPath) {
  const char* llama3_marker_tmpl = "<|start_header_id|><|end_header_id|>";
  auto [text, applied] = lisna::llm::format_chat_prompt(llama3_marker_tmpl, sample_chat());

  EXPECT_TRUE(applied);
  // LLAMA_3 apply writes "<|start_header_id|>{role}<|end_header_id|>\n\n..."
  // for each message + an "<|start_header_id|>assistant<|end_header_id|>\n\n"
  // trailer because we call with add_ass=true.
  EXPECT_NE(text.find("<|start_header_id|>system<|end_header_id|>"), std::string::npos);
  EXPECT_NE(text.find("<|start_header_id|>user<|end_header_id|>"), std::string::npos);
  EXPECT_NE(text.find("<|start_header_id|>assistant<|end_header_id|>"), std::string::npos);
  // Message contents survive the trim() inside apply.
  EXPECT_NE(text.find("You are helpful."), std::string::npos);
  EXPECT_NE(text.find("Hello."), std::string::npos);
}

// Fallback 1: tmpl == nullptr (GGUF has no embedded chat template). Function
// must short-circuit before calling llama_chat_apply_template and emit the raw
// [role] / [assistant] concatenation. applied=false so the caller flips
// add_special=true and the tokenizer prepends BOS.
TEST(ChatPrompt, NullTemplateReturnsRawConcatNotApplied) {
  auto [text, applied] = lisna::llm::format_chat_prompt(nullptr, sample_chat());

  EXPECT_FALSE(applied);
  EXPECT_NE(text.find("[system]"), std::string::npos);
  EXPECT_NE(text.find("[user]"), std::string::npos);
  EXPECT_NE(text.find("You are helpful."), std::string::npos);
  EXPECT_NE(text.find("Hello."), std::string::npos);
  // The role-tagged form ends with an [assistant] header so the model is
  // primed to start generating.
  EXPECT_NE(text.find("[assistant]"), std::string::npos);
  // No Llama-3 markers in the fallback shape.
  EXPECT_EQ(text.find("<|start_header_id|>"), std::string::npos);
}

// Fallback 2 (regression guard for the BOS bug). A non-null template that does
// NOT match any of llama-chat.cpp's detection patterns drives
// `llama_chat_apply_template` through the UNKNOWN branch and returns -1. The
// function must fall back to the raw-concat shape AND report applied=false.
// Pre-fix the caller in llama_engine.cpp computed have_template purely from
// (tmpl != nullptr), saw `true`, set add_special=false, and the tokenizer
// silently dropped BOS — corrupting the prompt for any out-of-list GGUF.
TEST(ChatPrompt, UnknownTemplateReturnsRawConcatNotApplied) {
  const char* bogus_tmpl = "{{ totally bogus template that matches nothing }}";
  auto [text, applied] = lisna::llm::format_chat_prompt(bogus_tmpl, sample_chat());

  EXPECT_FALSE(applied);
  EXPECT_NE(text.find("[system]"), std::string::npos);
  EXPECT_NE(text.find("[user]"), std::string::npos);
  EXPECT_NE(text.find("[assistant]"), std::string::npos);
  EXPECT_EQ(text.find("<|start_header_id|>"), std::string::npos);
}

} // namespace
