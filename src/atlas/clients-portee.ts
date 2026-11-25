/** Clients de l'espace pendant un appel (clients.ts les pose). Absent : le filtre « Est déjà client » se refuse. */
import { AsyncLocalStorage } from "node:async_hooks";

const portee = new AsyncLocalStorage<readonly string[]>();
export const clientsCourants = (): readonly string[] | null => portee.getStore() ?? null;
export const poserClients = <T>(sirens: readonly string[], f: () => Promise<T>): Promise<T> => portee.run(sirens, f);
