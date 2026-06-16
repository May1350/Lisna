#include "wav_reader.h"

#include <fstream>
#include <cstring>
#include <cstdint>
#include <algorithm>

namespace lisna::stt {

// Read 2 bytes as uint16 LE (alignment-safe).
static inline uint16_t read_u16le(const uint8_t* p) {
    return static_cast<uint16_t>(p[0]) | (static_cast<uint16_t>(p[1]) << 8);
}

// Read 4 bytes as uint32 LE (alignment-safe).
static inline uint32_t read_u32le(const uint8_t* p) {
    return static_cast<uint32_t>(p[0])
         | (static_cast<uint32_t>(p[1]) << 8)
         | (static_cast<uint32_t>(p[2]) << 16)
         | (static_cast<uint32_t>(p[3]) << 24);
}

bool read_wav_pcm16_mono_16k(const std::string& path, std::vector<float>& out, std::string& errOut) {
    out.clear();

    // --- Open and read the entire file ---
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f.is_open()) {
        errOut = "cannot open file: " + path;
        return false;
    }
    auto fileSize = static_cast<std::streamsize>(f.tellg());
    if (fileSize < 44) {
        errOut = "file too small for WAV header (need >= 44 bytes)";
        return false;
    }
    f.seekg(0, std::ios::beg);
    std::vector<uint8_t> buf(static_cast<size_t>(fileSize));
    if (!f.read(reinterpret_cast<char*>(buf.data()), fileSize)) {
        errOut = "read error";
        return false;
    }

    const uint8_t* h = buf.data();

    // --- Validate RIFF header ---
    if (std::memcmp(h + 0,  "RIFF", 4) != 0) { errOut = "bad RIFF magic";    return false; }
    if (std::memcmp(h + 8,  "WAVE", 4) != 0) { errOut = "bad WAVE marker";   return false; }
    if (std::memcmp(h + 12, "fmt ", 4) != 0) { errOut = "missing fmt chunk"; return false; }
    if (std::memcmp(h + 36, "data", 4) != 0) { errOut = "missing data chunk"; return false; }

    // --- Validate fmt sub-chunk fields ---
    uint16_t audioFormat   = read_u16le(h + 20);
    uint16_t channels      = read_u16le(h + 22);
    uint32_t sampleRate    = read_u32le(h + 24);
    uint16_t bitsPerSample = read_u16le(h + 34);

    if (audioFormat != 1 || channels != 1 || sampleRate != 16000 || bitsPerSample != 16) {
        errOut = "not PCM16 mono 16k (audioFormat=" + std::to_string(audioFormat)
               + " channels=" + std::to_string(channels)
               + " sampleRate=" + std::to_string(sampleRate)
               + " bitsPerSample=" + std::to_string(bitsPerSample) + ")";
        return false;
    }

    // --- Crash-safe: clamp to available data bytes ---
    uint32_t headerDataBytes = read_u32le(h + 40);
    size_t availableAfterHeader = static_cast<size_t>(fileSize) - 44u;
    // Round down to whole int16 samples (multiple of 2)
    size_t usableDataBytes = std::min(static_cast<size_t>(headerDataBytes), availableAfterHeader);
    usableDataBytes &= ~static_cast<size_t>(1); // floor to multiple of 2

    size_t numSamples = usableDataBytes / 2;
    out.reserve(numSamples);

    const uint8_t* pcm = h + 44;
    for (size_t i = 0; i < numSamples; ++i) {
        // Assemble int16 LE from two bytes (UB-safe, no reinterpret_cast on unaligned ptr)
        int16_t sample = static_cast<int16_t>(
            static_cast<uint16_t>(pcm[i * 2])
            | (static_cast<uint16_t>(pcm[i * 2 + 1]) << 8)
        );
        // Inverse of WavWriter: s<0 ? s/32768 : s/32767
        float fval = (sample < 0)
            ? static_cast<float>(sample) / 32768.0f
            : static_cast<float>(sample) / 32767.0f;
        out.push_back(fval);
    }

    return true;
}

} // namespace lisna::stt
