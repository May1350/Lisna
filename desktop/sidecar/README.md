# Lisna Sidecar (C++)

The on-device AI runtime — STT (whisper.cpp) + LLM (llama.cpp). Communicates with the Electron main process via stdin/stdout NDJSON.

## Build

```bash
pnpm --filter @lisna/desktop build:sidecar
# or:
cd desktop && pnpm build:sidecar
```

Output: `desktop/resources/sidecar` (executable).

## Dependencies

- `deps/json/json.hpp` — nlohmann/json v3.11.3 single header. SHA256: `9bea4c8066ef4a1c206b2be5a36302f8926f7fdc6087af5d20b417d0cf103ea6`. Source: https://github.com/nlohmann/json/releases/tag/v3.11.3

Phase 2.3 will add whisper.cpp as a git submodule under `deps/whisper.cpp`.
