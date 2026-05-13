if(POLICY CMP0135)
  cmake_policy(SET CMP0135 NEW)
endif()

include(FetchContent)
FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.tar.gz
)
FetchContent_MakeAvailable(googletest)

# json_protocol now includes whisper_engine.h and base64.h, so the test
# target must compile those TUs and link whisper.cpp (Metal on Apple).
# First cold build picks up whisper.cpp (~15-30s); subsequent builds cached.
add_executable(sidecar_tests
  test_json_protocol.cpp
  test_os_reclaim.cpp
  ../src/ipc/json_protocol.cpp
  ../src/ipc/base64.cpp
  ../src/stt/whisper_engine.cpp
  ../src/llm/llama_engine.cpp
  ../src/memory/os_reclaim.cpp
)
target_include_directories(sidecar_tests PRIVATE ../src ../deps/json)
target_link_libraries(sidecar_tests PRIVATE gtest_main whisper llama)

include(GoogleTest)
gtest_discover_tests(sidecar_tests)
