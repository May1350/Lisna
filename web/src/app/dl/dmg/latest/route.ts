import { redirect } from 'next/navigation';
import { env } from '@/lib/env';

export async function GET() {
  // Resolve latest GH release DMG URL via the GitHub API.
  // For alpha, hardcoded redirect is acceptable; switch to API resolution once auto-release is wired.
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;

  // next/navigation's redirect() throws a plain Error (digest = "NEXT_REDIRECT;…"),
  // so calling it inside a try/catch silently swallows the success-path redirect and
  // every request lands on the catch branch. Hoist the destination, call redirect()
  // exactly once after the try/catch.
  let target = `https://github.com/${owner}/${repo}/releases/latest`;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'lisna.jp',
      },
      // Cache the lookup for 5 minutes to avoid burning the unauth'd GH API rate limit
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`GH API ${res.status}`);
    const data = await res.json();
    const dmg = data.assets?.find(
      (a: { name: string; browser_download_url: string }) =>
        a.name.toLowerCase().endsWith('.dmg'),
    );
    if (dmg) target = dmg.browser_download_url;
  } catch {
    // Fall through to the default releases-page target.
  }
  redirect(target);
}
