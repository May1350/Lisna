#include "base64.h"
#include <array>

namespace lisna::ipc {

namespace {

constexpr int kInv = -1;

// Reverse lookup: ASCII byte -> 0..63, or kInv for non-alphabet characters.
const std::array<int8_t, 256>& table() {
  static const std::array<int8_t, 256> t = []{
    std::array<int8_t, 256> r{};
    for (auto& v : r) v = kInv;
    const char* alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (int i = 0; i < 64; ++i) {
      r[static_cast<uint8_t>(alphabet[i])] = static_cast<int8_t>(i);
    }
    return r;
  }();
  return t;
}

} // namespace

std::vector<uint8_t> b64_decode(const std::string& s) {
  std::vector<uint8_t> out;
  out.reserve((s.size() / 4) * 3);
  const auto& tbl = table();
  int val = 0;
  int bits = 0;
  for (unsigned char c : s) {
    // Tolerate whitespace.
    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') continue;
    // Stop at first '=' (padding); ignore any trailing characters.
    if (c == '=') break;
    int v = tbl[c];
    if (v < 0) return {}; // invalid char → empty vec
    val = (val << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<uint8_t>((val >> bits) & 0xFF));
    }
  }
  return out;
}

} // namespace lisna::ipc
