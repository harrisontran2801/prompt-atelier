import type { RouteMode } from "./routing.ts";

/** Only managed-paid may see the server xAI key. BYOK and free never do. */
export function measuredRunSecrets(
  mode: RouteMode,
  byokKey: string | undefined,
  env: { XAI_API_KEY?: string },
) {
  if (mode === "managed-paid") {
    return {
      userKey: undefined as string | undefined,
      managedServerKey: env.XAI_API_KEY?.trim() || undefined,
    };
  }
  if (mode === "byok") {
    return { userKey: byokKey?.trim() || undefined, managedServerKey: undefined as string | undefined };
  }
  return { userKey: undefined as string | undefined, managedServerKey: undefined as string | undefined };
}

/** Missing managed key refunds the hold. It never falls back to free or to a user key. */
export function managedExecutionPlan(mode: RouteMode, secrets: { userKey?: string; managedServerKey?: string }) {
  if (mode === "managed-paid" && !secrets.managedServerKey) {
    return { action: "refund" as const, fallback: false as const };
  }
  if (mode === "byok") {
    return { action: "run" as const, userKey: secrets.userKey, managedServerKey: undefined as string | undefined };
  }
  if (mode === "managed-paid") {
    return { action: "run" as const, userKey: undefined as string | undefined, managedServerKey: secrets.managedServerKey };
  }
  return { action: "run" as const, userKey: undefined as string | undefined, managedServerKey: undefined as string | undefined };
}
