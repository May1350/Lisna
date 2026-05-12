cmake_minimum_required(VERSION 3.20)
project(lisna_sidecar CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(LISNA_WITH_TESTS "Build GoogleTest tests" OFF)

add_executable(lisna_sidecar
  src/main.cpp
  src/ipc/json_protocol.cpp
)
target_include_directories(lisna_sidecar PRIVATE src deps/json)

if(LISNA_WITH_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
