#include <gtest/gtest.h>
#include "memory/os_reclaim.h"

#include <chrono>
#include <vector>

using lisna::memory::process_rss_bytes;
using lisna::memory::advise_release_and_wait;

TEST(OsReclaim, RssIsPositive) {
  EXPECT_GT(process_rss_bytes(), 0u);
}

TEST(OsReclaim, AdviseDoesNotCrashOnNull) {
  advise_release_and_wait(nullptr, 0, 1, 50);
  SUCCEED();
}

// Underflow guard: target larger than baseline RSS should return immediately
// instead of overflowing the threshold subtraction and spinning the full
// timeout. SIZE_MAX target == "drop more than the entire RSS", which is
// impossible — so we expect well-under-timeout return.
TEST(OsReclaim, ImpossibleTargetReturnsImmediately) {
  const auto start = std::chrono::steady_clock::now();
  advise_release_and_wait(nullptr, 0, static_cast<size_t>(-1), 1000);
  const auto elapsed = std::chrono::steady_clock::now() - start;
  EXPECT_LT(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count(),
            200);
}

// Realistic target (10MB drop) against a process that isn't actually freeing
// anything: the poll loop should hit the timeout rather than return early.
// Validates the wait actually waits — without this, a "return immediately"
// regression would pass the other tests silently.
TEST(OsReclaim, UnmetTargetWaitsForTimeout) {
  // 10MB is small enough to be a plausible drop, large enough that idle
  // jitter shouldn't satisfy it within the timeout window.
  constexpr size_t kTarget = 10 * 1024 * 1024;
  const auto start = std::chrono::steady_clock::now();
  // 400ms timeout (bumped from 200ms to absorb CI sleep quantization);
  // 150ms floor leaves 250ms slop.
  advise_release_and_wait(nullptr, 0, kTarget, 400);
  const auto elapsed = std::chrono::steady_clock::now() - start;
  EXPECT_GE(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count(),
            150);
}
