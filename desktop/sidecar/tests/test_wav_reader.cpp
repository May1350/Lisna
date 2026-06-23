#include <gtest/gtest.h>
#include "stt/wav_reader.h"

#include <fstream>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// Helper: write a minimal canonical 44-byte-header PCM16 mono 16kHz WAV.
// samples is a vector of int16 values in host byte order.
// ---------------------------------------------------------------------------
static void write_test_wav(const std::string& path, const std::vector<int16_t>& samples) {
    uint32_t dataBytes  = static_cast<uint32_t>(samples.size() * 2);
    uint32_t riffSize   = 36 + dataBytes;
    uint32_t fmtSize    = 16;
    uint16_t audioFmt   = 1;
    uint16_t channels   = 1;
    uint32_t sampleRate = 16000;
    uint32_t byteRate   = 32000;
    uint16_t blockAlign = 2;
    uint16_t bitsPerSample = 16;

    std::ofstream f(path, std::ios::binary);
    // RIFF chunk
    f.write("RIFF", 4);
    f.write(reinterpret_cast<const char*>(&riffSize), 4);
    f.write("WAVE", 4);
    // fmt sub-chunk
    f.write("fmt ", 4);
    f.write(reinterpret_cast<const char*>(&fmtSize), 4);
    f.write(reinterpret_cast<const char*>(&audioFmt), 2);
    f.write(reinterpret_cast<const char*>(&channels), 2);
    f.write(reinterpret_cast<const char*>(&sampleRate), 4);
    f.write(reinterpret_cast<const char*>(&byteRate), 4);
    f.write(reinterpret_cast<const char*>(&blockAlign), 2);
    f.write(reinterpret_cast<const char*>(&bitsPerSample), 2);
    // data sub-chunk
    f.write("data", 4);
    f.write(reinterpret_cast<const char*>(&dataBytes), 4);
    for (int16_t s : samples) {
        // little-endian
        uint8_t lo = static_cast<uint8_t>(s & 0xFF);
        uint8_t hi = static_cast<uint8_t>((s >> 8) & 0xFF);
        f.write(reinterpret_cast<const char*>(&lo), 1);
        f.write(reinterpret_cast<const char*>(&hi), 1);
    }
}

// ---------------------------------------------------------------------------
// Suite: WavReader
// ---------------------------------------------------------------------------
TEST(WavReader, HappyPath) {
    std::string path = "/tmp/lisna_wavreader_happy.wav";

    // Two known samples: one positive, one negative.
    // Positive:  s = 32767  → float = 32767 / 32767.0f = 1.0f
    // Negative:  s = -32768 → float = -32768 / 32768.0f = -1.0f
    int16_t posRaw = 32767;
    int16_t negRaw = -32768;
    write_test_wav(path, {posRaw, negRaw});

    std::vector<float> out;
    std::string err;
    bool ok = lisna::stt::read_wav_pcm16_mono_16k(path, out, err);

    EXPECT_TRUE(ok) << "err: " << err;
    ASSERT_EQ(out.size(), 2u);

    float expectedPos = static_cast<float>(posRaw) / 32767.0f;
    float expectedNeg = static_cast<float>(negRaw) / 32768.0f;
    EXPECT_NEAR(out[0], expectedPos, 1e-4f);
    EXPECT_NEAR(out[1], expectedNeg, 1e-4f);

    std::remove(path.c_str());
}

TEST(WavReader, BadMagic) {
    std::string path = "/tmp/lisna_wavreader_badmagic.wav";
    {
        std::ofstream f(path, std::ios::binary);
        // Write 44 bytes with wrong RIFF magic
        uint8_t header[44] = {};
        std::memcpy(header + 0,  "XXXX", 4); // bad magic
        std::memcpy(header + 8,  "WAVE", 4);
        std::memcpy(header + 12, "fmt ", 4);
        uint32_t fmtSize = 16; std::memcpy(header + 16, &fmtSize, 4);
        uint16_t af = 1; std::memcpy(header + 20, &af, 2);
        uint16_t ch = 1; std::memcpy(header + 22, &ch, 2);
        uint32_t sr = 16000; std::memcpy(header + 24, &sr, 4);
        uint32_t br = 32000; std::memcpy(header + 28, &br, 4);
        uint16_t ba = 2; std::memcpy(header + 32, &ba, 2);
        uint16_t bps = 16; std::memcpy(header + 34, &bps, 2);
        std::memcpy(header + 36, "data", 4);
        uint32_t db = 0; std::memcpy(header + 40, &db, 4);
        f.write(reinterpret_cast<const char*>(header), 44);
    }

    std::vector<float> out;
    std::string err;
    bool ok = lisna::stt::read_wav_pcm16_mono_16k(path, out, err);

    EXPECT_FALSE(ok);
    EXPECT_FALSE(err.empty()) << "expected a non-empty errOut";

    std::remove(path.c_str());
}

TEST(WavReader, TruncatedFile) {
    std::string path = "/tmp/lisna_wavreader_truncated.wav";
    {
        std::ofstream f(path, std::ios::binary);
        // Only 10 bytes — not a valid header
        uint8_t data[10] = {0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41};
        f.write(reinterpret_cast<const char*>(data), 10);
    }

    std::vector<float> out;
    std::string err;
    bool ok = lisna::stt::read_wav_pcm16_mono_16k(path, out, err);

    EXPECT_FALSE(ok);
    EXPECT_FALSE(err.empty());

    std::remove(path.c_str());
}

TEST(WavReader, CrashSafeTrailing) {
    // Header claims 4 bytes of PCM data (2 samples), but we only write 2 bytes
    // (1 sample). The reader must clamp to what's actually there (1 sample).
    std::string path = "/tmp/lisna_wavreader_trailing.wav";
    {
        uint32_t claimedDataBytes = 4; // claims 2 samples
        uint32_t riffSize = 36 + claimedDataBytes;
        std::ofstream f(path, std::ios::binary);
        f.write("RIFF", 4);
        f.write(reinterpret_cast<const char*>(&riffSize), 4);
        f.write("WAVE", 4);
        f.write("fmt ", 4);
        uint32_t fmtSize = 16; f.write(reinterpret_cast<const char*>(&fmtSize), 4);
        uint16_t af = 1; f.write(reinterpret_cast<const char*>(&af), 2);
        uint16_t ch = 1; f.write(reinterpret_cast<const char*>(&ch), 2);
        uint32_t sr = 16000; f.write(reinterpret_cast<const char*>(&sr), 4);
        uint32_t br = 32000; f.write(reinterpret_cast<const char*>(&br), 4);
        uint16_t ba = 2; f.write(reinterpret_cast<const char*>(&ba), 2);
        uint16_t bps = 16; f.write(reinterpret_cast<const char*>(&bps), 2);
        f.write("data", 4);
        f.write(reinterpret_cast<const char*>(&claimedDataBytes), 4);
        // Only write 2 bytes (1 int16 sample = 0x1234)
        uint8_t lo = 0x34, hi = 0x12;
        f.write(reinterpret_cast<const char*>(&lo), 1);
        f.write(reinterpret_cast<const char*>(&hi), 1);
        // Note: file ends here — 2 fewer bytes than header claims
    }

    std::vector<float> out;
    std::string err;
    bool ok = lisna::stt::read_wav_pcm16_mono_16k(path, out, err);

    EXPECT_TRUE(ok) << "err: " << err;
    ASSERT_EQ(out.size(), 1u) << "should read 1 sample (clamped from claimed 2)";
    // 0x1234 as int16 LE = 4660
    float expected = 4660.0f / 32767.0f;
    EXPECT_NEAR(out[0], expected, 1e-4f);

    std::remove(path.c_str());
}
