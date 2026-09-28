/**
 * Firestore(REST) 공용 도우미 — 서비스 계정(FIREBASE_SERVICE_ACCOUNT)으로 접근
 * api/ 폴더에서 _로 시작하는 파일은 Vercel이 엔드포인트로 만들지 않음
 */
import crypto from "crypto";

export function sa() { try { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || ""); } catch { return null; } }
let _tok = null, _tokExp = 0;
export async function gAccess(acc) {
  const now = Math.floor(Date.now() / 1000);
  if (_tok && now < _tokExp - 60) return _tok;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: acc.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(acc.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }) });
  const d = await r.json(); if (!d.access_token) throw new Error("service token"); _tok = d.access_token; _tokExp = now + 3600; return _tok;
}
export const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 32);

/** 문서 읽기 → fields (없으면 null) */
export async function fsGet(acc, path) {
  const tok = await gAccess(acc);
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${acc.project_id}/databases/(default)/documents/${path}`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null; return (await r.json()).fields || {};
}
/** 정수 필드 +1 (원자적 increment) */
export async function fsInc(acc, path, field = "n") {
  const tok = await gAccess(acc);
  const name = `projects/${acc.project_id}/databases/(default)/documents/${path}`;
  await fetch(`https://firestore.googleapis.com/v1/projects/${acc.project_id}/databases/(default)/documents:commit`, {
    method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: [{ transform: { document: name, fieldTransforms: [{ fieldPath: field, increment: { integerValue: "1" } }] } }] }) });
}
