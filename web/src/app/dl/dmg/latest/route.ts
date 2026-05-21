import { redirect } from 'next/navigation';
import { env } from '@/lib/env';

export async function GET() {
  // Resolve latest GH release DMG URL via the GitHub API.
  // For alpha, hardcoded redirect is acceptable; switch to API resolution once auto-release is wired.
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      // Cache the lookup for 5 minutes to avoid burning the unauth'd GH API rate limit
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`GH API ${res.status}`);
    const data = await res.json();
    const dmg = data.assets?.find((a: { name: string; browser_download_url: string }) => a.name.endsWith('.dmg'));
    if (!dmg) throw new Error('no DMG asset on latest release');
    redirect(dmg.browser_download_url);
  } catch {
    // Fallback to releases page if API fails or no release yet
    redirect(`https://github.com/${owner}/${repo}/releases/latest`);
  }
}
