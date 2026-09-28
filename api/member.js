/**
 * 얼리버드 회원 등록 — 구글 로그인으로 확인된 이메일을 Firestore(pharma-ai) members 컬렉션에 저장
 * POST /api/member   body: { token }  (구글 access token, 서버에서 구글에 직접 확인)
 * GET  /api/member?status=1             설정 확인용 (값은 노출하지 않음)
 * 키: Vercel 환경변수 FIREBASE_SERVICE_ACCOUNT (서비스 계정 JSON)
 */
import crypto from "crypto";

function sa() { try { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || ""); } catch { return null; } }
async function gAccess(acc) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: acc.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(acc.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }) });
  const d = await r.json(); if (!d.access_token) throw new Error("service token: " + JSON.stringify(d).slice(0, 120)); return d.access_token;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://allai.ai.kr");
  res.setHeader("Cache-Control", "no-store");
  const acc = sa();
  if (req.method === "GET") {
    // 상태 확인: /api/member?id=<sha256(email) 앞 32자> → { tier } (해제 여부 확인용, 이메일은 안 돌려줌)
    const qid = String(req.query.id || "").replace(/[^a-f0-9]/g, "").slice(0, 32);
    if (qid && acc) {
      try {
        const tok = await gAccess(acc);
        const r = await fetch(`https://firestore.googleapis.com/v1/projects/${acc.project_id}/databases/(default)/documents/members/${qid}`, { headers: { Authorization: `Bearer ${tok}` } });
        if (!r.ok) return res.status(200).json({ ok: true, tier: null });
        const d = await r.json(); return res.status(200).json({ ok: true, tier: d.fields?.tier?.stringValue || null });
      } catch { return res.status(200).json({ ok: false }); }
    }
    // 가입자 수: /api/member?count=1 (10분 캐시)
    if (req.query.count && acc) {
      try {
        const tok = await gAccess(acc);
        const q = await fetch(`https://firestore.googleapis.com/v1/projects/${acc.project_id}/databases/(default)/documents:runAggregationQuery`, { method: "POST",
          headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
          body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: "members" }] }, aggregations: [{ alias: "n", count: {} }] } }) });
        const n = q.ok ? Number((await q.json())?.[0]?.result?.aggregateFields?.n?.integerValue || 0) : null;
        res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
        return res.status(200).json({ ok: n !== null, n });
      } catch { return res.status(200).json({ ok: false }); }
    }
    return res.status(200).json({ configured: !!acc, project: acc?.project_id || null });
  }
  if (req.method !== "POST") return res.status(405).end();
  if (!acc) return res.status(200).json({ ok: false, error: "not_configured" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    // 1) 구글에 토큰 확인 → 진짜 이메일
    const u = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${body.token}` } }).then((r) => r.json());
    if (!u.email || !u.email_verified) return res.status(200).json({ ok: false, error: "invalid_login" });
    const email = String(u.email).toLowerCase();
    const id = crypto.createHash("sha256").update(email).digest("hex").slice(0, 32);
    const tok = await gAccess(acc);
    const base = `https://firestore.googleapis.com/v1/projects/${acc.project_id}/databases/(default)/documents/members/${id}`;
    const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
    // 2) 이미 등록돼 있으면 그대로 (번호·등록일 유지)
    const cafeNick = String(body.cafeNick || "").replace(/[<>"'`]/g, "").trim().slice(0, 30);
    const ex = await fetch(base, { headers: H });
    if (ex.ok) {
      const d = await ex.json();
      const tier = d.fields?.tier?.stringValue || "founder";
      if (tier === "revoked") return res.status(200).json({ ok: false, error: "revoked" });
      // 기존 회원이 카페 닉네임을 새로 적으면 저장
      if (cafeNick && d.fields?.cafeNick?.stringValue !== cafeNick)
        await fetch(`${base}?updateMask.fieldPaths=cafeNick`, { method: "PATCH", headers: H, body: JSON.stringify({ fields: { cafeNick: { stringValue: cafeNick } } }) });
      return res.status(200).json({ ok: true, already: true, joinedAt: d.fields?.joinedAt?.timestampValue, email, tier, cafeNick: cafeNick || d.fields?.cafeNick?.stringValue || "" });
    }
    const now = new Date().toISOString();
    const w = await fetch(base, { method: "PATCH", headers: H, body: JSON.stringify({ fields: {
      email: { stringValue: email }, name: { stringValue: u.name || "" }, tier: { stringValue: "early" }, cafeNick: { stringValue: cafeNick }, joinedAt: { timestampValue: now } } }) });
    if (!w.ok) return res.status(200).json({ ok: false, error: "db_" + w.status, detail: (await w.text()).slice(0, 200) });
    // 관리자 폰으로 가입 알림 (ntfy, 관리자 화면에서 연결한 경우)
    try {
      const cfg = await fetch(`https://firestore.googleapis.com/v1/projects/${acc.project_id}/databases/(default)/documents/config/admin`, { headers: H });
      const topic = cfg.ok ? (await cfg.json()).fields?.ntfyTopic?.stringValue : "";
      if (topic) {
        const q = await fetch(`https://firestore.googleapis.com/v1/projects/${acc.project_id}/databases/(default)/documents:runAggregationQuery`, { method: "POST", headers: H,
          body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: "members" }] }, aggregations: [{ alias: "n", count: {} }] } }) });
        const n = q.ok ? (await q.json())?.[0]?.result?.aggregateFields?.n?.integerValue : "";
        const masked = email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
        await fetch(`https://ntfy.sh/${topic}`, { method: "POST", headers: { Title: encodeURIComponent("ALLAI 초기 가입"), Tags: "tada", "Content-Type": "text/plain; charset=utf-8" },
          body: `${u.name || "새 회원"} (${masked})${cafeNick ? ` · 카페 닉네임 ${cafeNick}` : " · 카페 닉네임 없음"}${n ? ` · 총 ${n}명` : ""} (자동 승인)` });
      }
    } catch (e) {}
    return res.status(200).json({ ok: true, already: false, joinedAt: now, email, tier: "early", cafeNick });
  } catch (e) { return res.status(200).json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
}
