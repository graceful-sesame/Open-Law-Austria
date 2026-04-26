import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 Minuten
      retry: 1,
    },
  },
});

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function apiRequest(
  method: Method,
  url: string,
  body?: unknown
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${method} ${url} failed: ${response.status} ${text}`);
  }

  return response;
}

// ─── Admin Token (localStorage) ─────────────────────────────────────────────
const ADMIN_TOKEN_KEY = "ola_admin_token";

export function getAdminToken(): string {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) ?? ""; } catch { return ""; }
}

export function setAdminToken(token: string): void {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {}
}

/** Wie apiRequest, aber schickt automatisch den gespeicherten Admin-Token mit. */
export async function adminApiRequest(
  method: Method,
  url: string,
  body?: unknown
): Promise<Response> {
  const token = getAdminToken();
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body !== undefined) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${method} ${url} failed: ${response.status} ${text}`);
  }
  return response;
}
