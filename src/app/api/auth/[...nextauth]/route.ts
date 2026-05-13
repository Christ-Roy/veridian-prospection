// Auth.js v5 catch-all route handler.
// Gère tous les endpoints /api/auth/* : signin, signout, callback, session, csrf...
//
// Note : coexiste avec les routes Supabase Auth legacy tant que la transition
// vers Auth.js n'est pas finalisée (Phase 8). Auth.js ne touche qu'à /api/auth/*.

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
