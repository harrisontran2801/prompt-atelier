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
