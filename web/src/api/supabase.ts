// Klien Supabase ringan tanpa SDK: GoTrue (auth) + PostgREST (CRUD) via fetch.

const url = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = !!url && !!anonKey;

interface ReqOptions {
  method?: string;
  token?: string | null;
  body?: any;
  query?: string;
  returning?: boolean;
}

async function req(path: string, opts: ReqOptions = {}): Promise<any> {
  const headers: Record<string, string> = { apikey: anonKey };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.returning) headers.prefer = "return=representation";

  const qs = opts.query ? `?${opts.query}` : "";
  const res = await fetch(`${url}${path}${qs}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let msg = await res.text();
    try {
      const j = JSON.parse(msg);
      msg = j.msg || j.message || j.error_description || msg;
    } catch {}
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const supabase = {
  signUp(email: string, password: string) {
    return req("/auth/v1/signup", { method: "POST", body: { email, password } });
  },
  signIn(email: string, password: string) {
    return req("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email, password },
    });
  },
  signOut(token: string) {
    return req("/auth/v1/logout", { method: "POST", token });
  },
  getUser(token: string) {
    return req("/auth/v1/user", { token });
  },
  select(token: string, table: string, query = "") {
    return req(`/rest/v1/${table}`, { token, query });
  },
  insert(token: string, table: string, rows: any, opts: { returning?: boolean } = {}) {
    return req(`/rest/v1/${table}`, {
      method: "POST",
      token,
      body: rows,
      query: opts.returning ? "select=*" : undefined,
      returning: opts.returning,
    });
  },
  update(token: string, table: string, filter: string, patch: any) {
    return req(`/rest/v1/${table}?${filter}`, { method: "PATCH", token, body: patch });
  },
  delete(token: string, table: string, filter: string) {
    return req(`/rest/v1/${table}?${filter}`, { method: "DELETE", token });
  },
};
