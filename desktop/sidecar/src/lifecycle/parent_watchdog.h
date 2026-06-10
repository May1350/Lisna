#pragma once
#include <sys/types.h>

namespace lisna::lifecycle {

// Spawns a detached watchdog thread that polls getppid() every 500ms and
// _Exit(0)s the process when the parent changes (orphaned). Call ONCE from
// main, before entering the stdin dispatch loop.
//
// Why: the sidecar's only natural shutdown signal is stdin EOF. When the
// Electron parent dies abruptly (jetsam, SIGKILL, crash), EOF may never be
// observed — the child blocks in getline holding ~3 GB of model weights
// forever (founder-reported 10+ times). The watchdog is the guaranteed
// backstop independent of pipe state.
void install_parent_watchdog(pid_t expected_parent);

} // namespace lisna::lifecycle
