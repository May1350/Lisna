// web/src/lib/changelog.ts
import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'src/content/changelog');

export interface ChangelogEntry {
  slug: string;
  date: string;
  version: string;
  category: 'feature' | 'fix' | 'breaking';
  title: string;
  source: string;
}

function parseFrontmatter(source: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(source);
  if (!match) return {};
  return match[1].split('\n').reduce((acc, line) => {
    const m = /^(\w+):\s*(.+)$/.exec(line.trim());
    if (m) acc[m[1]] = m[2];
    return acc;
  }, {} as Record<string, string>);
}

const VALID_CATEGORIES: ChangelogEntry['category'][] = ['feature', 'fix', 'breaking'];

export async function listChangelog(): Promise<ChangelogEntry[]> {
  const files = await fs.readdir(DIR);
  const entries = await Promise.all(
    files.filter((f) => f.endsWith('.mdx')).map(async (f) => {
      const source = await fs.readFile(path.join(DIR, f), 'utf-8');
      const fm = parseFrontmatter(source);
      if (!(VALID_CATEGORIES as string[]).includes(fm.category)) {
        throw new Error(
          `${f}: invalid category "${fm.category}" (expected one of: ${VALID_CATEGORIES.join(', ')})`,
        );
      }
      return {
        slug: f.replace(/\.mdx$/, ''),
        date: fm.date,
        version: fm.version,
        category: fm.category as ChangelogEntry['category'],
        title: fm.title,
        source,
      };
    })
  );
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
