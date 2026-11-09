import { PrismaClient } from "@prisma/client";
import { appliquerBornesDb } from "@/lib/db-bornes";

// Aussi hors du serveur Next (scripts, tests) : jamais de requête sans borne de temps.
appliquerBornesDb();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
