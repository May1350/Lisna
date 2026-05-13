if(POLICY CMP0135)
  cmake_policy(SET CMP0135 NEW)
endif()

include(FetchContent)
FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.tar.gz
)
FetchContent_MakeAvailable(googletest)

add_executable(sidecar_tests
  test_json_protocol.cpp
  ../src/ipc/json_protocol.cpp
)
target_include_directories(sidecar_tests PRIVATE ../src ../deps/json)
target_link_libraries(sidecar_tests PRIVATE gtest_main)

include(GoogleTest)
gtest_discover_tests(sidecar_tests)
