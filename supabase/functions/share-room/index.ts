import { createClient } from "npm:@supabase/supabase-js@2";
const ORIGINS = ["https://banditkmc23-ai.github.io", "http://localhost:8799"];
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const PUB = Deno.env.get("SUPABASE_URL") + "/storage/v1/object/public/room-photos/";
const MAX_IMG = 2 * 1024 * 1024, MAX_N = 12, MAX_BODY = 30 * 1024 * 1024;
const hits = new Map<string, number[]>();
function limited(ip: string) { const now = Date.now(); const a = (hits.get(ip) || []).filter(t => now - t < 3600_000); a.push(now); hits.set(ip, a); return a.length > 30; }
function cors(req: Request) { const o = req.headers.get("origin") || ""; return { "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" }; }
const J = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
function sniff(b: Uint8Array): [string, string] | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ["image/jpeg", "jpg"];
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ["image/png", "png"];
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return ["image/webp", "webp"];
  return null;
}
const A = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), x => A[x % A.length]).join("");
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x < 1e10 ? x : 0; };
function clean(d: any) {
  d = d && typeof d === "object" ? d : {}; const a = d.a && typeof d.a === "object" ? d.a : {};
  return { v: 1, p: str(d.p, 120), b: str(d.b, 80), r: str(d.r, 30), f: str(d.f, 20), rent: num(d.rent), sale: num(d.sale) || "", sz: num(d.sz), t: str(d.t, 40), bt: str(d.bt, 10), vw: str(d.vw, 40), st: str(d.st, 20), d: str(d.d, 900), hr: d.hr ? 1 : 0, a: { n: str(a.n, 60), ph: str(a.ph, 30), l: str(a.l, 60) } };
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const url = new URL(req.url);
  if (req.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!/^[A-Za-z0-9]{4,12}$/.test(id)) return J(req, { error: "bad id" }, 400);
    const { data, error } = await sb.from("shared_rooms").select("data").eq("id", id).maybeSingle();
    if (error) return J(req, { error: "db" }, 500);
    if (!data) return J(req, { error: "not found" }, 404);
    return J(req, { data: data.data });
  }
  if (req.method !== "POST") return J(req, { error: "method" }, 405);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  if (limited(ip)) return J(req, { error: "rate limited" }, 429);
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return J(req, { error: "payload too large" }, 413);
  let body: any; try { const t = await req.text(); if (t.length > MAX_BODY) return J(req, { error: "payload too large" }, 413); body = JSON.parse(t); } catch { return J(req, { error: "bad json" }, 400); }
  const imgs: unknown[] = Array.isArray(body.images) ? body.images : [];
  if (imgs.length > MAX_N) return J(req, { error: "too many images (max 12)" }, 400);
  const files: ([Uint8Array, string, string] | string)[] = [];
  const PUBRE = new RegExp("^" + PUB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[A-Za-z0-9]{4,12}/\\d{1,2}\\.(jpg|png|webp)$");
  for (const s of imgs) {
    if (s && typeof s === "object" && typeof (s as any).url === "string") { if (!PUBRE.test((s as any).url)) return J(req, { error: "bad image url" }, 400); files.push((s as any).url); continue; }
    if (typeof s !== "string" || s.length > MAX_IMG * 1.4) return J(req, { error: "image too large (max 2MB)" }, 413);
    let b: Uint8Array; try { b = Uint8Array.from(atob(s.replace(/^data:[^,]*,/, "")), c => c.charCodeAt(0)); } catch { return J(req, { error: "bad image encoding" }, 400); }
    if (b.length > MAX_IMG) return J(req, { error: "image too large (max 2MB)" }, 413);
    const t = sniff(b); if (!t) return J(req, { error: "only jpeg/png/webp allowed" }, 415);
    files.push([b, t[0], t[1]]);
  }
  const data = clean(body.data); const id = rid(); const urls: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (typeof f === "string") { urls.push(f); continue; }
    const path = `${id}/${i + 1}.${f[2]}`;
    const { error } = await sb.storage.from("room-photos").upload(path, f[0], { contentType: f[1], upsert: false });
    if (error) return J(req, { error: "upload failed" }, 500);
    urls.push(PUB + path);
  }
  const { error } = await sb.from("shared_rooms").insert({ id, data: { ...data, imgs: urls } });
  if (error) return J(req, { error: "insert failed" }, 500);
  return J(req, { id, imgs: urls });
});
