# Lisna model manifest — operator runbook

This directory holds `model-manifest.v1.json`, the source-of-truth list of
downloadable models. This README describes the one-time infrastructure setup
and ongoing procedures for updating model files, credentials, and the alpha
allowlist.

---

## R2 bucket setup (one-time)

1. **Cloudflare dashboard → R2 → Create bucket**
   - Name: `lisna-models-prod`
   - Location: Automatic
   - Public access: **off**

2. **R2 → Manage R2 API Tokens → Create API Token**
   - Name: `lisna-models-prod-rw` (or any identifier)
   - Permission: Object Read & Write (scoped to `lisna-models-prod`)
   - TTL: no expiry

3. **Copy credentials** — the resulting `Access Key ID`, `Secret Access Key`,
   and endpoint URL (e.g. `https://<acct>.r2.cloudflarestorage.com`).

4. **AWS Secrets Manager Console → `studyhelper/model-download`** (NOT
   `studyhelper/app`) → Retrieve secret value → Edit JSON:
   - Replace `R2_ACCESS_KEY_ID` value with the key from step 3
   - Replace `R2_SECRET_ACCESS_KEY` value with the secret from step 3
   - Replace `R2_ENDPOINT_URL` value with the full endpoint URL
   - Save

5. **R2 versioning ON**: Bucket → Settings → Versioning → Enable

---

## Model upload (per new model)

1. **Identify the target R2 key** from `model-manifest.v1.json`'s `object_key`
   field. Current models:

   | Slot | object_key |
   |------|-----------|
   | stt  | `kotoba-whisper-v2.0/q5_0/whisper.bin` |
   | llm  | `Llama-3.2-3B-Instruct/Q4_K_M/llm.gguf` |

2. **Upload via Cloudflare dashboard** (drag-and-drop into the bucket path)
   OR via aws-cli with R2 endpoint override:

   ```bash
   # Configure an aws-cli profile for R2 once:
   aws configure --profile r2
   # AWS Access Key ID: <R2_ACCESS_KEY_ID>
   # AWS Secret Access Key: <R2_SECRET_ACCESS_KEY>
   # Default region: auto
   # Default output format: json

   # Upload whisper model:
   aws s3 cp ./whisper.bin \
     s3://lisna-models-prod/kotoba-whisper-v2.0/q5_0/whisper.bin \
     --endpoint-url https://<acct>.r2.cloudflarestorage.com \
     --profile r2

   # Upload LLM:
   aws s3 cp ./llm.gguf \
     s3://lisna-models-prod/Llama-3.2-3B-Instruct/Q4_K_M/llm.gguf \
     --endpoint-url https://<acct>.r2.cloudflarestorage.com \
     --profile r2
   ```

3. **Compute the file's SHA256**:

   ```bash
   shasum -a 256 ./whisper.bin
   shasum -a 256 ./llm.gguf
   ```

4. **Edit `backend/manifests/model-manifest.v1.json`** — fill in:
   - `size_bytes` = file size in bytes (`wc -c < <file>` on macOS)
   - `sha256` = hash from step 3

5. **Upload the license text** to R2 at `licenses/<license_id>.txt`, then
   compute its SHA256 and set `license_text_sha256` in the manifest:

   ```bash
   # Current license IDs:
   #   kotoba-whisper-tin    → licenses/kotoba-whisper-tin.txt
   #   llama-3.2-community   → licenses/llama-3.2-community.txt

   aws s3 cp ./kotoba-whisper-tin.txt \
     s3://lisna-models-prod/licenses/kotoba-whisper-tin.txt \
     --endpoint-url https://<acct>.r2.cloudflarestorage.com \
     --profile r2

   shasum -a 256 ./kotoba-whisper-tin.txt
   ```

6. **PR → main merge** → `deploy-backend.yml` auto-deploys the updated Lambda.

---

## DR posture

- R2 versioning is ON. If a bad upload corrupts an object, revert it via
  the Cloudflare dashboard (bucket → object → version history → restore).
- Cross-region replication is OFF (cost +20%); accepted RPO = 7 days for alpha.
- Manifest source-of-truth = git repo. Worst case: revert the manifest commit
  and redeploy; desktop clients fall back to their bundled model.

---

## Allowlist management

Alpha access is controlled by `backend/infra/allowlist-emails.json`. CDK
syncs this file to `studyhelper/model-download` → `ALLOWLIST_EMAILS` on
every deploy.

- **Add a user** — add an entry with `holdout: false` (treatment) or
  `holdout: true` (control cohort):

  ```json
  { "email": "user@example.com", "holdout": false }
  ```

- **Flow**: edit `infra/allowlist-emails.json` → PR → main merge → CDK deploy
  auto-syncs the allowlist to Secrets Manager → Lambda picks it up on next
  cold start (no manual steps).

- **Audit trail**: `git log -p infra/allowlist-emails.json`

- **Ceiling**: ~500 entries. If alpha exceeds this, migrate to a DB-backed
  allowlist per spec §F2.
