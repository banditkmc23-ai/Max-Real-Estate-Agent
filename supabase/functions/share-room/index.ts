import { createClient } from "npm:@supabase/supabase-js@2";
const ORIGINS = ["https://banditkmc23-ai.github.io", "http://localhost:8799"];
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const PUB = Deno.env.get("SUPABASE_URL") + "/storage/v1/object/public/room-photos/";
const MAX_IMG = 2 * 1024 * 1024, MAX_N = 40, MAX_BODY = 30 * 1024 * 1024;
const buckets = new Map<string, Map<string, number[]>>();
function limited(ip: string, max = 120, kind = "w", win = 3600_000) { const hits = buckets.get(kind) || new Map<string, number[]>(); buckets.set(kind, hits); const now = Date.now(); const a = (hits.get(ip) || []).filter(t => now - t < win); a.push(now); hits.set(ip, a); if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > win) hits.delete(k); return a.length > max; }
const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
const OWNER = "051c9fdb-a563-4b3c-8a33-2e3661d7b4cc";
async function isOwner(req: Request) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok || tok.split(".").length !== 3) return false;
  const { data, error } = await sb.auth.getUser(tok);
  return !error && !!data?.user && data.user.id === OWNER;
}
function extract(desc, sn, sd) {
  desc = String(desc || ""); sn = String(sn || ""); sd = Number(sd) || 0;
  if (!sn) { const m = desc.match(/(BTS|MRT|ARL|Airport Link)\s*([ก-๙A-Za-z0-9 ]+?)(?:\s*(?:เพียง|ประมาณ)?\s*([\d,.]+)\s*(ม\.|เมตร|m|km|กม\.))?(?=[\s|,·\n]|$)/); if (m) { sn = (m[1] + " " + m[2].replace(/\s*(ฟรี|free)$/i, "")).trim().slice(0, 60); if (m[3]) sd = parseFloat(m[3].replace(/,/g, "")) * (/k|กม/.test(m[4]) ? 1000 : 1) || 0; } }
  const cn = /ห้องมุม|corner/i.test(desc) ? 1 : 0;
  const tm = []; let m;
  if ((m = desc.match(/สัญญา[^\n\d]*?(\d+)\s*(ปี|เดือน)/))) tm.push(["สัญญาขั้นต่ำ", m[1] + " " + m[2]]);
  else if ((m = desc.match(/minimum[^\n\d]*?(\d+)[\s-]*(year|month)/i))) tm.push(["สัญญาขั้นต่ำ", m[1] + " " + (/y/i.test(m[2]) ? "ปี" : "เดือน")]);
  if ((m = desc.match(/ล่วงหน้า\s*(\d+)\s*เดือน/))) tm.push(["ล่วงหน้า", m[1] + " เดือน"]);
  if ((m = desc.match(/(?:ประกัน|มัดจำ)\s*(\d+)\s*เดือน/))) tm.push(["เงินประกัน", m[1] + " เดือน"]);
  return { sn, sd, cn, tm };
}

// public view of a room: never expose the free-text description
function pub(d: any) {
  d = d && typeof d === "object" ? { ...d } : {};
  if ("d" in d) { const x = extract(d.d, d.sn, d.sd); d.sn = x.sn; d.sd = x.sd; d.cn = d.cn ?? x.cn; d.tm = d.tm ?? x.tm; delete d.d; }
  return d;
}
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
function clean0(d: any) {
  d = d && typeof d === "object" ? d : {}; const a = d.a && typeof d.a === "object" ? d.a : {};
  return { v: 1, p: str(d.p, 120), b: str(d.b, 80), r: str(d.r, 30), f: str(d.f, 20), rent: num(d.rent), sale: num(d.sale) || "", sz: num(d.sz), t: str(d.t, 40), bt: str(d.bt, 10), vw: str(d.vw, 40), sn: str(d.sn, 60), sd: num(d.sd), st: str(d.st, 20), hr: d.hr ? 1 : 0, a: { n: str(a.n, 60), ph: str(a.ph, 30), l: str(a.l, 60) } };
}
function clean(d: any) { const c: any = clean0(d); const x = extract(str(d && d.d, 4000), c.sn, c.sd); c.sn = x.sn.slice(0, 60); c.sd = num(x.sd); c.cn = x.cn; c.tm = x.tm; return c; }
const sha256 = async (t: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))), b => b.toString(16).padStart(2, "0")).join("");
async function canEdit(id: string, secret: unknown) {
  if (typeof secret !== "string" || secret.length < 16 || secret.length > 128) return false;
  const { data } = await sb.from("shared_rooms").select("edit_hash").eq("id", id).maybeSingle();
  return !!(data && data.edit_hash && data.edit_hash === await sha256(secret));
}
const GH = Deno.env.get("GITHUB_OG_TOKEN") || "";
const SITE = "https://banditkmc23-ai.github.io/Max-Real-Estate-Agent/";
const H = (x: unknown) => String(x ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
const fmt = (n: number) => "฿" + Number(n || 0).toLocaleString("en-US");
function ogHtml(id: string, d: any, img: string, rev = "") {
  const title = [d.p || "ห้องให้เช่า", d.r ? "ห้อง " + d.r : ""].filter(Boolean).join(" · ");
  const bits = [d.rent ? fmt(d.rent) + "/เดือน" : "", d.sale ? "ขาย " + fmt(d.sale) : "", d.t, d.sz ? d.sz + " ตร.ม." : "", d.f ? "ชั้น " + d.f : "", d.a && d.a.ph ? "โทร " + d.a.ph : ""].filter(Boolean).join(" · ");
  const desc = bits.slice(0, 200);
  const url = SITE + "r/" + id + "/", to = "../../room.html?id=" + id;
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${H(title)} — MAX Agent</title><meta name="description" content="${H(desc)}">
<meta name="x-rev" content="${H(rev)}"><meta property="og:type" content="website"><meta property="og:site_name" content="MAX Agent"><meta property="og:title" content="${H(title)}">
<meta property="og:description" content="${H(desc)}"><meta property="og:url" content="${H(url)}">
${img ? `<meta property="og:image" content="${H(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : ""}
<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}"><meta name="twitter:title" content="${H(title)}"><meta name="twitter:description" content="${H(desc)}">${img ? `<meta name="twitter:image" content="${H(img)}">` : ""}
<meta http-equiv="refresh" content="0;url=${to}"><script>location.replace(${JSON.stringify(to)} + location.hash)</script>
</head><body><a href="${to}">เปิดดูห้อง</a></body></html>`;
}
let lastGh = "";
async function writeOgPage(id: string, d: any, img: string, rev = "") { return writeGh(`r/${id}/index.html`, ogHtml(id, d, img, rev), `share: room page r/${id}`); }
function catHtml(id: string, d: any, rev: string) {
  const n = (d.agent && d.agent.n) || "เอเจนต์"; const c = (d.rooms || []).length;
  const title = `ห้องว่าง ${c} ห้อง · ${n}`; const desc = `ดูห้องว่างพร้อมเข้าอยู่ ${c} ห้อง ราคา รูป และทักไลน์ได้ทันที`;
  const img = (d.rooms || []).map((r: any) => r.cover).find(Boolean) || SITE + "icons/icon-512.png";
  const url = SITE + "a/" + id + "/", to = "../../agent.html?id=" + id;
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-rev" content="${H(rev)}">
<title>${H(title)}</title><meta name="description" content="${H(desc)}"><meta property="og:type" content="website"><meta property="og:site_name" content="MAX Agent">
<meta property="og:title" content="${H(title)}"><meta property="og:description" content="${H(desc)}"><meta property="og:url" content="${H(url)}"><meta property="og:image" content="${H(img)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${H(title)}"><meta name="twitter:image" content="${H(img)}">
<meta http-equiv="refresh" content="0;url=${to}"><script>location.replace(${JSON.stringify(to)})</script></head><body><a href="${to}">ดูห้องว่าง</a></body></html>`;
}
async function writeGh(path: string, html: string, message: string) {
  if (!GH) { lastGh = "no token"; return false; }
  const content = btoa(String.fromCharCode(...new TextEncoder().encode(html)));
  const api = `https://api.github.com/repos/banditkmc23-ai/Max-Real-Estate-Agent/contents/${path}`;
  const hdr = { Authorization: "Bearer " + GH, Accept: "application/vnd.github+json", "User-Agent": "max-agent-share", "X-GitHub-Api-Version": "2022-11-28" };
  for (let t = 0; t < 5; t++) {
    let sha: string | undefined;
    const g = await fetch(api + "?ref=main", { headers: hdr }); if (g.ok) sha = (await g.json()).sha; else await g.body?.cancel();
    const r = await fetch(api, { method: "PUT", headers: hdr, body: JSON.stringify({ message: message + (sha ? " (update)" : ""), content, branch: "main", ...(sha ? { sha } : {}) }) });
    lastGh = String(r.status);
    if (r.ok) return true;
    if (r.status === 422 && !sha) continue; // created concurrently; retry with sha
    if (r.status === 409 || r.status === 422 || r.status >= 500 || r.status === 403) { await new Promise(res => setTimeout(res, 400 * (t + 1) + Math.random() * 600)); continue; }
    console.error("gh", r.status, (await r.text()).slice(0, 200)); return false;
  }
  return false;
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ip = ipOf(req);
    if (limited(ip, 3000, "r")) return J(req, { error: "rate limited" }, 429);
  }
  if (req.method === "GET" && url.searchParams.get("cat")) {
    if ((buckets.get("miss")?.get(ipOf(req)) || []).filter(t => Date.now() - t < 3600_000).length > 60) return J(req, { error: "rate limited" }, 429);
    const id = url.searchParams.get("cat") || "";
    if (!/^[A-Za-z0-9]{6}$/.test(id)) return J(req, { error: "bad id" }, 400);
    const { data } = await sb.from("catalogs").select("data, updated_at").eq("id", id).maybeSingle();
    if (!data) { limited(ipOf(req), 60, "miss"); return J(req, { error: "not found" }, 404); }
    return J(req, { data: data.data, updated_at: data.updated_at });
  }
  if (req.method === "GET") {
    if ((buckets.get("miss")?.get(ipOf(req)) || []).filter(t => Date.now() - t < 3600_000).length > 60) return J(req, { error: "rate limited" }, 429);
    const id = url.searchParams.get("id") || "";
    if (!/^[A-Za-z0-9]{4,12}$/.test(id)) return J(req, { error: "bad id" }, 400);
    const { data, error } = await sb.from("shared_rooms").select("data").eq("id", id).maybeSingle();
    if (error) return J(req, { error: "db" }, 500);
    if (!data) {
      // legacy links glued to extra chars (e.g. "K82gDC01.jpg"): match the longest known id prefix
      const pre = []; for (let n = id.length - 1; n >= 4; n--) pre.push(id.slice(0, n));
      const { data: hits } = pre.length ? await sb.from("shared_rooms").select("id,data").in("id", pre) : { data: [] };
      const hit = (hits || []).sort((a: any, b: any) => b.id.length - a.id.length)[0];
      if (hit) return J(req, { data: pub(hit.data), id: hit.id });
      limited(ipOf(req), 60, "miss"); return J(req, { error: "not found" }, 404);
    }
    return J(req, { data: pub(data.data), id });
  }
  if (req.method !== "POST") return J(req, { error: "method" }, 405);
  const ip = ipOf(req);
  if (limited(ip, 300)) return J(req, { error: "rate limited" }, 429);
  if (!(await isOwner(req))) return J(req, { error: "login required" }, 401);
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return J(req, { error: "payload too large" }, 413);
  let body: any; try { const t = await req.text(); if (t.length > MAX_BODY) return J(req, { error: "payload too large" }, 413); body = JSON.parse(t); } catch { return J(req, { error: "bad json" }, 400); }
  if (body && body.action === "catalog") {
    const ROOMRE = /^[A-Za-z0-9]{6}$/;
    const a = body.agent && typeof body.agent === "object" ? body.agent : {};
    const av = typeof a.av === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a.av) && a.av.length < 40000 ? a.av : "";
    const rooms = (Array.isArray(body.rooms) ? body.rooms : []).slice(0, 200).filter((r: any) => r && ROOMRE.test(String(r.id))).map((r: any) => ({
      id: String(r.id), p: str(r.p, 120), b: str(r.b, 80), t: str(r.t, 40), sz: num(r.sz), bt: str(r.bt, 10), f: str(r.f, 20), vw: str(r.vw, 40), rent: num(r.rent), sale: num(r.sale) || 0,
      cover: typeof r.cover === "string" && r.cover.startsWith(PUB) && r.cover.length < 300 ? r.cover : "" }));
    // only list rooms that really exist as shared rooms
    if (rooms.length) { const { data: ex } = await sb.from("shared_rooms").select("id").in("id", rooms.map((r: any) => r.id)); const ok = new Set((ex || []).map((x: any) => x.id)); for (let i = rooms.length - 1; i >= 0; i--) if (!ok.has(rooms[i].id)) rooms.splice(i, 1); }
    const data = { v: 1, agent: { n: str(a.n, 60), l: str(a.l, 60), ph: str(a.ph, 30), bio: str(a.bio, 160), av }, rooms };
    const sec = body.secret; if (typeof sec !== "string" || sec.length < 16 || sec.length > 128) return J(req, { error: "secret required" }, 400);
    let id = String(body.id || ""); const rev = Date.now().toString(36);
    if (id) {
      if (!ROOMRE.test(id)) return J(req, { error: "bad id" }, 400);
      const { data: row } = await sb.from("catalogs").select("edit_hash").eq("id", id).maybeSingle();
      if (!row || row.edit_hash !== await sha256(sec)) return J(req, { error: "not allowed" }, 403);
      const { error } = await sb.from("catalogs").update({ data, updated_at: new Date().toISOString() }).eq("id", id); if (error) return J(req, { error: "save failed" }, 500);
    } else {
      id = rid(); const { error } = await sb.from("catalogs").insert({ id, data, edit_hash: await sha256(sec) }); if (error) return J(req, { error: "save failed" }, 500);
    }
    const page = await writeGh(`a/${id}/index.html`, catHtml(id, data, rev), `catalog: agent page a/${id}`);
    return J(req, { id, count: rooms.length, page, rev });
  }
  if (body && body.action === "init") {
    const n = Math.max(0, Math.min(MAX_N, Number(body.count) || 0));
    let id = rid();
    if (body.id) { if (!/^[A-Za-z0-9]{6}$/.test(String(body.id)) || !(await canEdit(String(body.id), body.secret))) return J(req, { error: "not allowed" }, 403); id = String(body.id); }
    const v = Date.now().toString(36);
    // stable per-photo files: <id>/p-<photoKey>.jpg — uploaded once, reused by every later share
    if (Array.isArray(body.keys)) {
      const keys = body.keys.slice(0, MAX_N).map((k: unknown) => String(k)).filter((k: string) => /^[A-Za-z0-9_-]{1,60}$/.test(k));
      const { data: objs } = await sb.storage.from("room-photos").list(id, { limit: 1000 });
      const have = new Set((objs || []).map(o => o.name));
      const ups2 = await Promise.all(keys.map(async (key: string) => {
        const path = `${id}/p-${key}.jpg`;
        if (have.has(`p-${key}.jpg`)) return { key, path, url: PUB + path, exists: true };
        const { data, error } = await sb.storage.from("room-photos").createSignedUploadUrl(path, { upsert: true });
        if (error || !data) throw error; return { key, path, token: data.token, url: PUB + path };
      })).catch(() => null);
      if (!ups2) return J(req, { error: "sign failed" }, 500);
      let og2 = null;
      if (body.og) { const { data } = await sb.storage.from("room-photos").createSignedUploadUrl(`${id}/og-${v}.jpg`); if (data) og2 = { name: `og-${v}.jpg`, path: `${id}/og-${v}.jpg`, token: data.token, url: PUB + `${id}/og-${v}.jpg` }; }
      return J(req, { id, uploads: ups2, og: og2, v });
    }
    const ups = await Promise.all(Array.from({ length: n }, async (_, k) => {
      const path = `${id}/${v}-${k + 1}.jpg`; const { data, error } = await sb.storage.from("room-photos").createSignedUploadUrl(path);
      if (error || !data) throw error; return { path, token: data.token, url: PUB + path };
    })).catch(() => null);
    if (!ups) return J(req, { error: "sign failed" }, 500);
    let og = null;
    if (body.og) { const { data } = await sb.storage.from("room-photos").createSignedUploadUrl(`${id}/og-${v}.jpg`); if (data) og = { path: `${id}/og-${v}.jpg`, token: data.token, url: PUB + `${id}/og-${v}.jpg` }; }
    return J(req, { id, uploads: ups, og, v });
  }
  if (body && body.action === "commit") {
    const id = String(body.id || ""); if (!/^[A-Za-z0-9]{6}$/.test(id)) return J(req, { error: "bad id" }, 400);
    const list: unknown[] = Array.isArray(body.images) ? body.images.slice(0, MAX_N) : [];
    const PUBRE2 = new RegExp("^" + PUB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[A-Za-z0-9]{4,12}/[A-Za-z0-9_-]{1,80}\\.(jpg|png|webp)$");
    const { data: existing } = await sb.from("shared_rooms").select("id").eq("id", id).maybeSingle();
    const isUpdate = !!existing;
    if (isUpdate && !(await canEdit(id, body.secret))) return J(req, { error: "not allowed" }, 403);
    if (!isUpdate && (typeof body.secret !== "string" || body.secret.length < 16 || body.secret.length > 128)) return J(req, { error: "secret required" }, 400);
    const urls = list.map(x => (x && typeof x === "object" ? String((x as any).url || "") : "")).filter(u => PUBRE2.test(u));
    const own = urls.filter(u => u.startsWith(PUB + id + "/")).map(u => u.slice(PUB.length + id.length + 1));
    if (own.length) { const { data: objs } = await sb.storage.from("room-photos").list(id, { limit: 1000 }); const have = new Set((objs || []).map(o => o.name)); if (own.some(n => !have.has(n))) return J(req, { error: "photo missing" }, 400); }
    const { data: objs2 } = await sb.storage.from("room-photos").list(id, { limit: 1000 });
    const v = /^[a-z0-9]{4,12}$/.test(String(body.v || "")) ? String(body.v) : "";
    const has2 = (n: string) => (objs2 || []).some(o => o.name === n);
    const ogReq = /^og-[a-z0-9]{4,12}\.jpg$/.test(String(body.og || "")) ? String(body.og) : "";
    const ogName = ogReq && has2(ogReq) ? ogReq : v && has2(`og-${v}.jpg`) ? `og-${v}.jpg` : (has2("og.jpg") ? "og.jpg" : "");
    const cd = clean(body.data);
    const row = { data: { ...cd, imgs: urls }, updated_at: new Date().toISOString() };
    const { error } = isUpdate ? await sb.from("shared_rooms").update(row).eq("id", id) : await sb.from("shared_rooms").insert({ id, ...row, edit_hash: await sha256(body.secret) });
    if (error) return J(req, { error: "save failed" }, 500);
    // photos the owner deleted in the app: drop their stable files (<id>/p-<key>.jpg) unless this commit still uses them
    let pruned = 0;
    if (isUpdate && Array.isArray(body.gone) && urls.length) {
      const live = new Set(own);
      const del = body.gone.slice(0, 200).map((k: unknown) => String(k)).filter((k: string) => /^[A-Za-z0-9_-]{1,60}$/.test(k)).map((k: string) => `p-${k}.jpg`).filter((n: string) => has2(n) && !live.has(n) && !urls.some(u => u.endsWith("/" + n)));
      if (del.length) { const { error: e2 } = await sb.storage.from("room-photos").remove(del.map((n: string) => `${id}/${n}`)); if (!e2) pruned = del.length; }
    }
    const page = await writeOgPage(id, cd, ogName ? PUB + id + "/" + ogName : (urls[0] || ""), v);
    return J(req, { id, imgs: urls, page, og: ogName, updated: isUpdate, pruned, ...(page ? {} : { pageErr: lastGh }) });
  }
  return J(req, { error: "unknown action" }, 400);
});
