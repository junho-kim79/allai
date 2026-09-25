/**
 * MR 한마디 — 창립 멤버 작성 → 관리자 승인 후 노출
 * GET  /api/say                         승인된 한마디 목록 (지역·익명)
 * POST /api/say {action:'post', token, text, sido}         작성 (창립 멤버, 하루 5개)
 * POST /api/say {action:'queue'|'approve'|'reject'|'setup', token, id}  관리자
 * 알림: 새 글이 오면 ntfy.sh/<topic> 으로 푸시 (topic은 관리자 화면에서 만든 값, Firestore config/admin)
 * 저장: Firestore (pharma-ai) says / members / config
 */
import crypto from "crypto";

const ADMINS = (process.env.ADMIN_EMAILS || "junhoangel@gmail.com,k.no1.realtor@gmail.com").toLowerCase().split(",").map((s) => s.trim());
const MAX_LEN = 120, PER_DAY = 5;

function sa() { try { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || ""); } catch { return null; } }
let _tok = null, _tokExp = 0;
async function svcToken(acc) {
  if (_tok && Date.now() < _tokExp - 60000) return _tok;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const u = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: acc.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign("RSA-SHA256").update(u).sign(acc.private_key, "base64url");
  const d = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${u}.${sig}` }) })).json();
  if (!d.access_token) throw new Error("service token");
  _tok = d.access_token; _tokExp = Date.now() + 3500e3; return _tok;
}
// Firestore 값 변환
const toF = (v) => typeof v === "number" ? { integerValue: String(v) } : v instanceof Date ? { timestampValue: v.toISOString() } : { stringValue: String(v ?? "") };
const fromF = (f = {}) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.stringValue ?? v.timestampValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : null)]));
async function db(acc, method, path, body) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${acc.project_id}/databases/(default)/documents${path}`, {
    method, headers: { Authorization: `Bearer ${await svcToken(acc)}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`db ${r.status} ${(await r.text()).slice(0, 150)}`);
  return r.json();
}
async function query(acc, field, value) {   // 단일 조건 조회 (복합 색인 없이)
  const rows = await db(acc, "POST", ":runQuery", { structuredQuery: { from: [{ collectionId: "says" }],
    where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: toF(value) } }, limit: 300 } });
  return (rows || []).filter((r) => r.document).map((r) => ({ id: r.document.name.split("/").pop(), ...fromF(r.document.fields) }));
}
async function whoAmI(token) {
  const u = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } })).json();
  if (!u.email || !u.email_verified) throw new Error("login");
  return String(u.email).toLowerCase();
}
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
const pub = (s) => ({ id: s.id, text: s.text, sido: s.sido, at: s.createdAt });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://allai.ai.kr");
  const acc = sa();
  if (!acc) return res.status(200).json({ ok: false, error: "not_configured", items: [] });
  try {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
      const items = (await query(acc, "status", "approved")).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100).map(pub);
      return res.status(200).json({ ok: true, items });
    }
    res.setHeader("Cache-Control", "no-store");
    const b = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const email = await whoAmI(b.token);

    if (b.action === "post") {
      const member = await db(acc, "GET", `/members/${hash(email)}`);
      if (!member) return res.status(200).json({ ok: false, error: "not_member" });
      const text = String(b.text || "").replace(/\s+/g, " ").trim();
      if (text.length < 5 || text.length > MAX_LEN) return res.status(200).json({ ok: false, error: "length" });
      const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      const mine = await query(acc, "author", hash(email));
      if (mine.filter((s) => String(s.createdAt || "").slice(0, 10) === today).length >= PER_DAY) return res.status(200).json({ ok: false, error: "limit" });
      const sido = String(b.sido || "").slice(0, 10);
      await db(acc, "POST", "/says", { fields: { text: toF(text), sido: toF(sido), author: toF(hash(email)), email: toF(email), status: toF("pending"), createdAt: toF(new Date()) } });
      // 관리자에게 푸시
      const cfg = await db(acc, "GET", "/config/admin");
      const topic = cfg ? fromF(cfg.fields).ntfyTopic : "";
      if (topic) await fetch(`https://ntfy.sh/${topic}`, { method: "POST", headers: { Title: encodeURIComponent("ALLAI 새 한마디 승인 대기"), Tags: "loudspeaker", Click: "https://allai.ai.kr/#admin-say", "Content-Type": "text/plain; charset=utf-8" },
        body: `[${sido || "지역 없음"}] ${text}` }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    if (!ADMINS.includes(email)) return res.status(200).json({ ok: false, error: "not_admin" });
    if (b.action === "queue") {
      const items = (await query(acc, "status", "pending")).sort((a, b2) => String(a.createdAt).localeCompare(String(b2.createdAt)))
        .map((s) => ({ ...pub(s), email: s.email }));
      const cfg = await db(acc, "GET", "/config/admin");
      return res.status(200).json({ ok: true, items, ntfyTopic: cfg ? fromF(cfg.fields).ntfyTopic || "" : "" });
    }
    if (b.action === "approve" || b.action === "reject") {
      const id = String(b.id || "").replace(/[^A-Za-z0-9]/g, "");
      await db(acc, "PATCH", `/says/${id}?updateMask.fieldPaths=status&updateMask.fieldPaths=reviewedAt`,
        { fields: { status: toF(b.action === "approve" ? "approved" : "rejected"), reviewedAt: toF(new Date()) } });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "setup") {   // 알림 주제(topic) 새로 만들기
      const topic = "allai-" + crypto.randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x");
      await db(acc, "PATCH", "/config/admin", { fields: { ntfyTopic: toF(topic) } });
      await fetch(`https://ntfy.sh/${topic}`, { method: "POST", headers: { Title: encodeURIComponent("ALLAI 알림 연결 완료") }, body: "새 한마디가 올라오면 여기로 알려드려요." }).catch(() => {});
      return res.status(200).json({ ok: true, ntfyTopic: topic });
    }
    return res.status(400).json({ ok: false, error: "action" });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e.message || e).slice(0, 200) });
  }
}
