import fs from 'node:fs/promises';
import path from 'node:path';

const DOCS_DIR = path.join(process.cwd(), 'src/content/docs');

export async function loadDocBySlug(slug: string[]): Promise<{ source: string } | null> {
  const filePath = path.join(DOCS_DIR, slug.join('/') + '.mdx');
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    // Strip leading YAML frontmatter block so MDXRemote doesn't render
    // the `---` fences as <hr/> and the key:value lines as paragraph text.
    // Task 41 keeps the loader interface minimal; future task can expand
    // to { source, frontmatter } when generateMetadata needs the title.
    const source = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
    return { source };
  } catch {
    return null;
  }
}

export async function listDocs(): Promise<string[]> {
  const files = await fs.readdir(DOCS_DIR);
  return files.filter((f) => f.endsWith('.mdx')).map((f) => f.replace(/\.mdx$/, ''));
}
