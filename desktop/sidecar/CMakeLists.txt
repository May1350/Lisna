cmake_minimum_required(VERSION 3.20)
project(lisna_sidecar CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(LISNA_WITH_TESTS "Build GoogleTest tests" OFF)

# llama.cpp options — Metal on Apple Silicon, strip examples + tests + server + tools.
# b9128 uses GGML_METAL (same renamed option as whisper.cpp); llama.cpp must be
# added FIRST so its (newer) ggml defines the shared "ggml" CMake target.
# whisper.cpp's guard (NOT TARGET ggml) then reuses it, preventing version mismatch.
# LLAMA_METAL is the deprecated alias; GGML_METAL is the canonical name.
set(GGML_METAL ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS    OFF CACHE BOOL "" FORCE)
add_subdirectory(deps/llama.cpp EXCLUDE_FROM_ALL)

# whisper.cpp options — Metal on (Apple Silicon target), strip examples + tests.
# v1.7.x renamed WHISPER_METAL → GGML_METAL (lives in ggml/CMakeLists.txt now);
# on APPLE GGML_METAL_DEFAULT is already ON, but we force it for explicitness.
# whisper.cpp is added AFTER llama.cpp so its (NOT TARGET ggml) guard reuses
# llama.cpp's newer ggml — both deps share the same Metal-enabled ggml build.
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory(deps/whisper.cpp EXCLUDE_FROM_ALL)

add_executable(lisna_sidecar
  src/main.cpp
  src/ipc/json_protocol.cpp
  src/ipc/base64.cpp
  src/stt/whisper_engine.cpp
  src/llm/llama_engine.cpp
  src/memory/os_reclaim.cpp
)
target_include_directories(lisna_sidecar PRIVATE src deps/json)
target_link_libraries(lisna_sidecar PRIVATE whisper llama)

if(LISNA_WITH_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
