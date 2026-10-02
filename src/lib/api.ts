export type MicrosoftUser = { identityProvider: string; userDetails: string; userRoles: string[] };

export async function usuarioActual(): Promise<MicrosoftUser | null> {
  const response = await fetch("/.auth/me", { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json() as { clientPrincipal?: MicrosoftUser | null };
  return data.clientPrincipal?.identityProvider === "aad" ? data.clientPrincipal : null;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/${path}`, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error || `No pudimos completar la solicitud (HTTP ${response.status}).`);
  }
  return await response.json() as T;
}

export async function apiRemito(id: string): Promise<Blob> {
  const response = await fetch(`/api/staff-remito?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error || "No pudimos abrir el remito.");
  }
  return await response.blob();
}

export const apiConfigurada = true;
