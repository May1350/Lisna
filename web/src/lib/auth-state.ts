import { auth } from './auth';

export async function getAuthState(): Promise<'guest' | { name: string; email: string; image?: string | null }> {
  const session = await auth();
  if (!session?.user) return 'guest';
  return {
    name: session.user.name ?? session.user.email ?? 'You',
    email: session.user.email ?? '',
    image: session.user.image ?? null,
  };
}
