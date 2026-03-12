import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

let prismaClient: PrismaClient | undefined = globalForPrisma.prisma;
let reconnectInFlight: Promise<PrismaClient> | null = null;

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
  });

  return new PrismaClient({
    adapter,
    log: ["warn", "error"],
  });
}

function getPrismaClient() {
  if (!prismaClient) {
    prismaClient = createPrismaClient();

    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = prismaClient;
    }
  }

  return prismaClient;
}

function isPrismaConnectionError(error: unknown) {
  const message =
    (error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string" &&
      (error as { message: string }).message) ||
    String(error ?? "");

  const lowered = message.toLowerCase();

  return (
    lowered.includes("not queryable") ||
    lowered.includes("connection terminated unexpectedly") ||
    lowered.includes("connection error") ||
    lowered.includes("can't reach database server") ||
    lowered.includes("server has closed the connection")
  );
}

function isPromiseLike<T = unknown>(value: unknown): value is Promise<T> {
  return !!value && typeof (value as Promise<T>).then === "function";
}

async function reconnectPrismaClient() {
  if (reconnectInFlight) {
    return reconnectInFlight;
  }

  reconnectInFlight = (async () => {
    const previousClient = prismaClient;
    prismaClient = undefined;

    if (previousClient) {
      try {
        await previousClient.$disconnect();
      } catch {
        // Ignore disconnect failures while rotating a broken client.
      }
    }

    const nextClient = createPrismaClient();
    prismaClient = nextClient;

    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = nextClient;
    }

    return nextClient;
  })();

  try {
    return await reconnectInFlight;
  } finally {
    reconnectInFlight = null;
  }
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const activeClient = getPrismaClient();
    const member = Reflect.get(activeClient, property, activeClient);

    if (typeof member !== "function") {
      return member;
    }

    return (...args: unknown[]) => {
      const run = (client: PrismaClient) => {
        const fn = Reflect.get(client, property, client);

        if (typeof fn !== "function") {
          throw new Error(`Prisma member ${String(property)} is not callable.`);
        }

        return fn.apply(client, args);
      };

      try {
        const result = run(getPrismaClient());

        if (!isPromiseLike(result)) {
          return result;
        }

        return result.catch(async (error: unknown) => {
          if (!isPrismaConnectionError(error)) {
            throw error;
          }

          const refreshedClient = await reconnectPrismaClient();
          return run(refreshedClient);
        });
      } catch (error) {
        if (!isPrismaConnectionError(error)) {
          throw error;
        }

        return reconnectPrismaClient().then((refreshedClient) =>
          run(refreshedClient),
        );
      }
    };
  },
});
