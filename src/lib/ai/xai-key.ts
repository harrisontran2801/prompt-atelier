/** A public run never reads the server env. Managed execution passes the server key in. */
export function resolveXaiKey(userKey?: string, managedServerKey?: string) {
  const managed = managedServerKey?.trim();
  if (managed) return managed;
  const user = userKey?.trim();
  return user || "";
}
