// web/src/app/changelog/rss.xml/route.ts
import { listChangelog } from '@/lib/changelog';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function GET() {
  const entries = await listChangelog();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Lisna Changelog</title>
    <link>https://lisna.jp/changelog</link>
    <description>Release notes for Lisna desktop</description>
${entries.map((e) => `    <item>
      <title>v${esc(e.version)} — ${esc(e.title)}</title>
      <link>https://lisna.jp/changelog#${esc(e.slug)}</link>
      <pubDate>${new Date(e.date).toUTCString()}</pubDate>
      <description><![CDATA[${e.title}]]></description>
    </item>`).join('\n')}
  </channel>
</rss>`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
