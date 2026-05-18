#pragma once
#include <string>
#include <vector>
#include <cstdint>

namespace lisna::ipc {

// Decode a base64 string into raw bytes.
// - Standard alphabet (A-Z a-z 0-9 + /), '=' padding.
// - Whitespace (space, tab, CR, LF) is tolerated.
// - On any invalid character, returns an empty vector (no exception).
// - Empty input returns an empty vector.
std::vector<uint8_t> b64_decode(const std::string& s);

} // namespace lisna::ipc
