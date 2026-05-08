// One-shot dev / ops convenience: bump a user's plan to 'pro' and clear
// their quota_usage rows for the current period. Replaces the old
// migration `003_dev_user_pro.sql`, which hardcoded a personal email
// into the migration history (which is replicated forever and survives
// fork/clone of the DB).
//
// Usage from backend/:
//   pnpm tsx scripts/grant-pro.ts <email>
//
// Requires DATABASE_URL or DB_SECRET_ARN to be set in the environment
// (the same way the Lambda handlers connect). Safe to re-run; the email
// filter makes it idempotent and the quota_usage delete is harmless on
// a fresh row.
//
// IMPORTANT: this script touches production data. Confirm the email is
// what you want before running. There's no undo.

import { query } from '../src/lib/db.js'

async function main(): Promise<void> {
  const email = process.argv[2]
  if (!email || !email.includes('@')) {
    console.error('Usage: pnpm tsx scripts/grant-pro.ts <email>')
    process.exit(2)
  }

  const updated = await query<{ id: string; email: string; plan: string }>(
    `UPDATE users
        SET plan = 'pro'
      WHERE email = $1 AND plan != 'pro'
      RETURNING id, email, plan`,
    [email],
  )

  if (updated.length === 0) {
    // Either the user doesn't exist or is already pro. Distinguish.
    const existing = await query<{ id: string; plan: string }>(
      `SELECT id, plan FROM users WHERE email = $1`,
      [email],
    )
    if (existing.length === 0) {
      console.error(`No user with email '${email}'. Have they signed in yet?`)
      process.exit(1)
    }
    console.log(`User ${email} is already on plan='${existing[0].plan}'.`)
  } else {
    console.log(`Bumped ${updated[0].email} (${updated[0].id}) to plan='pro'.`)
  }

  const cleared = await query<{ user_id: string; period: string }>(
    `DELETE FROM quota_usage
       WHERE user_id IN (SELECT id FROM users WHERE email = $1)
     RETURNING user_id, period`,
    [email],
  )
  console.log(`Cleared ${cleared.length} quota_usage row(s).`)
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1) })
