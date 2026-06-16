#pragma once
#include <string>
#include <vector>
namespace lisna::stt {
// Reads a canonical 44-byte-header PCM16 mono 16 kHz WAV (exactly what the
// TypeScript WavWriter emits) into float samples in [-1, 1]. Returns false and
// sets errOut on any open/format error; out is cleared first.
bool read_wav_pcm16_mono_16k(const std::string& path, std::vector<float>& out, std::string& errOut);
}
