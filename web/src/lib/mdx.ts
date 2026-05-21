import fs from 'node:fs/promises';
import path from 'node:path';

const DOCS_DIR = path.join(process.cwd(), 'src/content/docs');

export async function loadDocBySlug(slug: string[]): Promise<{ source: string } | null> {
  const filePath = path.join(DOCS_DIR, slug.join('/') + '.mdx');
  try {
    const source = await fs.readFile(filePath, 'utf-8');
    return { source };
  } catch {
    return null;
  }
}

export async function listDocs(): Promise<string[]> {
  const files = await fs.readdir(DOCS_DIR);
  return files.filter((f) => f.endsWith('.mdx')).map((f) => f.replace(/\.mdx$/, ''));
}
