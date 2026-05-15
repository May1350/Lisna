#pragma once
#include "llama_engine.h"  // ChatMessage
#include <string>
#include <utility>
#include <vector>

namespace lisna::llm {

// Format `messages` into a single prompt string using the supplied GGUF chat
// template (typically the pointer returned by `llama_model_chat_template`).
//
// Returns (text, applied):
//   - text:    the formatted prompt. On fallback it is a role-tagged raw
//              concatenation ([role]\ncontent\n... + [assistant]\n).
//   - applied: true iff `llama_chat_apply_template` succeeded. Callers MUST
//              drive tokenizer `add_special = !applied`: a successful apply
//              already embeds BOS in `text`, the fallback shape does not.
//
// Two fallback paths:
//   1. tmpl == nullptr  — model has no embedded chat template.
//   2. tmpl != nullptr but `llama_chat_apply_template` returned -1 — template
//      exists but is not in llama.cpp's pre-defined supported list
//      (see llama.h:1159). Pre-fix this case silently dropped BOS because the
//      caller decided `add_special` from tmpl-nullness alone, not apply-success.
std::pair<std::string, bool> format_chat_prompt(
    const char* tmpl,
    const std::vector<ChatMessage>& messages);

} // namespace lisna::llm
