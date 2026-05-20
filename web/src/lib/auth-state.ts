export async function getAuthState(): Promise<'guest' | { name: string; email: string; image?: string | null }> {
  // Phase J wires this to Auth.js session
  return 'guest';
}
