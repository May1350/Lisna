export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'
// Lambda Function URL for /v1/session/curate — bypasses API Gateway HTTP
// API's hard 30 s integration timeout (curator runs can hit 50–90 s).
// When unset, the SW falls back to API_BASE_URL/v1/session/curate so dev
// builds and the existing API GW route still work.
export const CURATE_URL = import.meta.env.VITE_CURATE_URL || ''
