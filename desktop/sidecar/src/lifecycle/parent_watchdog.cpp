#include "parent_watchdog.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <thread>
#include <unistd.h>

namespace lisna::lifecycle {

void install_parent_watchdog(pid_t expected_parent) {
  // Parent already gone before we got here (spawn/exec race) — exit now.
  if (getppid() != expected_parent) {
    std::_Exit(0);
  }
  std::thread([expected_parent] {
    for (;;) {
      std::this_thread::sleep_for(std::chrono::milliseconds(500));
      if (getppid() != expected_parent) {
        // Parent died; we were re-parented (to launchd on macOS). stderr is
        // best-effort — the pipe may be broken, and that must not stop the
        // exit (fprintf to a broken pipe returns EPIPE as an error code, it
        // does not raise SIGPIPE; only write()-family raises).
        std::fprintf(stderr, "[lifecycle] parent %d gone (now %d) — exiting\n",
                     static_cast<int>(expected_parent), static_cast<int>(getppid()));
        // _Exit, not exit(): static destructors would tear down Metal/model
        // state from this non-main thread — deadlock risk inside GPU driver
        // teardown. The kernel reclaims RAM and Metal resources regardless.
        std::_Exit(0);
      }
    }
  }).detach();
}

} // namespace lisna::lifecycle
