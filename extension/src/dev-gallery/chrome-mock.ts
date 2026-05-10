// Minimal in-memory chrome.* shim for the dev gallery.
//
// The gallery renders real components in a normal browser window — there is
// no extension runtime. Components that read chrome.storage.local at module
// load (i18n bootstrap, captions/rail collapse keys, cached quota) need a
// shim or they crash the page. We satisfy the *shape* without implementing
// extension semantics.

type StorageRecord = Record<string, unknown>

const store: StorageRecord = {}
const listeners: Array<(changes: Record<string, { newValue: unknown; oldValue: unknown }>, area: string) => void> = []

function fireChange(changes: Record<string, { newValue: unknown; oldValue: unknown }>) {
  for (const cb of listeners) {
    try { cb(changes, 'local') } catch { /* swallow — listener errors should not break the page */ }
  }
}

const localArea = {
  get(keys: string | string[] | StorageRecord | null | undefined, cb?: (items: StorageRecord) => void) {
    let result: StorageRecord = {}
    if (keys == null) {
      result = { ...store }
    } else if (typeof keys === 'string') {
      if (keys in store) result[keys] = store[keys]
    } else if (Array.isArray(keys)) {
      for (const k of keys) if (k in store) result[k] = store[k]
    } else {
      for (const k of Object.keys(keys)) {
        result[k] = k in store ? store[k] : (keys as StorageRecord)[k]
      }
    }
    const promise = Promise.resolve(result)
    if (cb) promise.then(cb)
    return promise
  },
  set(items: StorageRecord, cb?: () => void) {
    const changes: Record<string, { newValue: unknown; oldValue: unknown }> = {}
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: store[k], newValue: v }
      store[k] = v
    }
    fireChange(changes)
    const promise = Promise.resolve()
    if (cb) promise.then(cb)
    return promise
  },
  remove(keys: string | string[], cb?: () => void) {
    const arr = Array.isArray(keys) ? keys : [keys]
    const changes: Record<string, { newValue: unknown; oldValue: unknown }> = {}
    for (const k of arr) {
      if (k in store) {
        changes[k] = { oldValue: store[k], newValue: undefined }
        delete store[k]
      }
    }
    fireChange(changes)
    const promise = Promise.resolve()
    if (cb) promise.then(cb)
    return promise
  },
  clear(cb?: () => void) {
    const changes: Record<string, { newValue: unknown; oldValue: unknown }> = {}
    for (const k of Object.keys(store)) {
      changes[k] = { oldValue: store[k], newValue: undefined }
      delete store[k]
    }
    fireChange(changes)
    const promise = Promise.resolve()
    if (cb) promise.then(cb)
    return promise
  },
}

const messageListeners: Array<(msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => void | boolean> = []

const fakeChrome = {
  storage: {
    local: localArea,
    onChanged: {
      addListener(cb: (changes: Record<string, { newValue: unknown; oldValue: unknown }>, area: string) => void) {
        listeners.push(cb)
      },
      removeListener(cb: typeof listeners[number]) {
        const i = listeners.indexOf(cb)
        if (i >= 0) listeners.splice(i, 1)
      },
    },
  },
  runtime: {
    id: 'dev-gallery-mock',
    sendMessage(_msg: unknown, cb?: (r: unknown) => void) {
      // No real handler — return null. Callers that await this should
      // tolerate either undefined or {ok:false}.
      const promise = Promise.resolve(null)
      if (cb) promise.then(cb as (r: unknown) => void)
      return promise
    },
    onMessage: {
      addListener(cb: (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => void | boolean) {
        messageListeners.push(cb)
      },
      removeListener(cb: typeof messageListeners[number]) {
        const i = messageListeners.indexOf(cb)
        if (i >= 0) messageListeners.splice(i, 1)
      },
    },
    getURL(p: string) {
      return new URL(p, window.location.origin).toString()
    },
    lastError: undefined as undefined | { message: string },
  },
  tabs: {
    query: () => Promise.resolve([]),
    sendMessage: () => Promise.resolve(null),
  },
  i18n: {
    getMessage: (k: string) => k,
  },
}

export function installChromeMock(seed: StorageRecord = {}): void {
  Object.assign(store, seed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).chrome = fakeChrome
}

export function setStorage(items: StorageRecord): void {
  Object.assign(store, items)
}
