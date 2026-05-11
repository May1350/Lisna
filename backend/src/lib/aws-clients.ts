// Shared AWS SDK client singletons.
//
// Lambda containers reuse module-scoped values across invocations.
// Constructing a SecretsManagerClient (or any AWS SDK client) is
// cheap, but the FIRST .send() pays a TCP+TLS handshake; if env.ts
// and db.ts each instantiate their own client, the cold start
// races TWO handshakes. Single shared client → one handshake,
// reused for both loadAppSecrets and the DB password fetch.
//
// Clients are sync-constructable (no I/O until .send() is called),
// so we don't need a lazy promise wrapper — a simple memoized
// getter is enough.

import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'

let secretsClient: SecretsManagerClient | undefined

export function getSecretsManager(): SecretsManagerClient {
  if (!secretsClient) secretsClient = new SecretsManagerClient({})
  return secretsClient
}
