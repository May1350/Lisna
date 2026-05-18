#pragma once
#include <cstddef>

namespace lisna::memory {

// Process resident set size in bytes. Returns 0 on probe failure (caller
// treats 0 as "unknown" — never as "process has no memory").
size_t process_rss_bytes();

// After freeing a large allocation, the kernel may keep pages mapped to this
// process until reuse pressure forces eviction. On macOS the only honest signal
// that pages have actually returned to the OS is the mach RSS counter dropping.
//
// Optionally advises MADV_DONTNEED on (addr, length) if non-null, then polls
// RSS at 50ms intervals until either RSS has dropped by at least targetDropBytes
// from the pre-call baseline OR timeoutMs elapses. Returns either way — this is
// a best-effort barrier, not a hard guarantee, so unload() Promise resolution
// can claim "memory has been returned" with reasonable honesty.
//
// Baseline RSS is sampled inside this call (post-madvise), not threaded in from
// the caller. Reclamation lags free() so this matches the pre-free reading in
// practice; callers needing exact pre-free RSS for diagnostics should snapshot
// it themselves.
void advise_release_and_wait(void* addr, size_t length,
                             size_t targetDropBytes, int timeoutMs);

} // namespace lisna::memory
