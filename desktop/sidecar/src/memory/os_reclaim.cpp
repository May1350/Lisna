#include "os_reclaim.h"

#include <mach/mach.h>
#include <mach/task.h>
#include <mach/task_info.h>
#include <sys/mman.h>

#include <chrono>
#include <cstdio>
#include <thread>

namespace lisna::memory {

size_t process_rss_bytes() {
  mach_task_basic_info_data_t info{};
  mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
  kern_return_t kr = task_info(mach_task_self(), MACH_TASK_BASIC_INFO,
                               reinterpret_cast<task_info_t>(&info), &count);
  if (kr != KERN_SUCCESS) return 0;
  return static_cast<size_t>(info.resident_size);
}

void advise_release_and_wait(void* addr, size_t length,
                             size_t targetDropBytes, int timeoutMs) {
  // MADV_DONTNEED is best-effort on Darwin (POSIX_MADV_DONTNEED) — ignore
  // failures. We still rely on the RSS poll below for real confirmation.
  if (addr && length) {
    (void)madvise(addr, length, MADV_DONTNEED);
  }

  const size_t before = process_rss_bytes();
  // Underflow guard: if RSS probe failed or baseline is below the target,
  // there's nothing meaningful to wait for.
  if (before == 0 || before <= targetDropBytes) return;
  const size_t threshold = before - targetDropBytes;

  const auto deadline =
      std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
  size_t now = before;
  while (std::chrono::steady_clock::now() < deadline) {
    now = process_rss_bytes();
    if (now != 0 && now <= threshold) return;
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
  // Timed out without confirmation — unload() Promise will still resolve, but
  // log so swap-class regressions are diagnosable in production logs.
  // now=0 means the mach probe failed (per process_rss_bytes contract), NOT
  // "RSS dropped to zero" — split the branch so debuggers don't chase a
  // phantom 2.5GB drain.
  if (now == 0) {
    fprintf(stderr,
            "[os_reclaim] target %zu bytes not met within %d ms; "
            "RSS before=%zu now=unknown (probe failed)\n",
            targetDropBytes, timeoutMs, before);
  } else {
    fprintf(stderr,
            "[os_reclaim] target %zu bytes not met within %d ms; "
            "RSS before=%zu now=%zu drop=%lld\n",
            targetDropBytes, timeoutMs, before, now,
            static_cast<long long>(before) - static_cast<long long>(now));
  }
}

} // namespace lisna::memory
