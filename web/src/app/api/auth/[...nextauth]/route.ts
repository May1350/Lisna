// web/src/app/api/auth/[...nextauth]/route.ts
import { handlers } from '@/lib/auth';

// Re-export pattern: auth.ts exports handlers as { GET, POST } object from NextAuth().
export const { GET, POST } = handlers;
