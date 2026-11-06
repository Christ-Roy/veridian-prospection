// Auth.js v5 catch-all route handler.
// Gère tous les endpoints /api/auth/* : signin, signout, callback, session, csrf...

import { handlers } from "@/lib/auth-config";

export const { GET, POST } = handlers;
