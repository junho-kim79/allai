/**
 * 약가DB 자동 갱신 (적용일 기준 변경분 반영)
 * - 심평원 약가기준정보를 "적용일(adtStaDd)"별로 조회 → 그날 바뀐 품목만 받아서 drugPriceDB.js에 반영
 * - 변경 내역은 priceChanges.json에 누적 (앱의 "약가 변동" 화면이 사용)
 * - 데이터 경로: allai.ai.kr/api/price (공공데이터 키는 Vercel에만 있음)
 * - 안전장치: 조회 실패가 많거나 결과가 비정상이면 파일을 바꾸지 않고 실패 처리
 */
import fs from "fs";

const BASE = process.env.PRICE_API || "https://allai.ai.kr/api/price";
const DB_FILE = new URL("../drugPriceDB.js", import.meta.url);
const CH_FILE = new URL("../priceChanges.json", import.meta.url);
const KEEP_DAYS = 400;               // 변경 내역 보관 기간
const FIRST_LOOKBACK_DAYS = 120;     // 처음 실행 시 거슬러 올라갈 기간

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kst = () => new Date(Date.now() + 9 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const addDays = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

async function get(params) {
  const qs = new URLSearchParams({ rows: "1000", ...params, _: String(Date.now()) });
  for (let t = 1; t <= 4; t++) {
    try {
      const d = await (await fetch(`${BASE}?${qs}`)).json();
      if (d.error) throw new Error(d.error);
      return d;
    } catch (e) { if (t === 4) throw e; await sleep(2500 * t); }
  }
}
async function changesOn(date) {
  const first = await get({ adtStaDd: date, page: "1" });
  const items = [...first.items];
  const pages = Math.ceil((first.totalCount || 0) / 1000);
  for (let p = 2; p <= pages; p++) items.push(...(await get({ adtStaDd: date, page: String(p) })).items);
  return items;
}

// ── 기존 데이터 ──
const dbTxt = fs.readFileSync(DB_FILE, "utf8");
const db = JSON.parse(dbTxt.slice(dbTxt.indexOf("["), dbTxt.lastIndexOf("]") + 1));
const byCode = new Map(db.map((d) => [String(d.c), d]));
const log = fs.existsSync(CH_FILE) ? JSON.parse(fs.readFileSync(CH_FILE, "utf8")) : { lastDate: "", changes: [] };
console.log("기존 품목:", db.length, "| 마지막 반영일:", log.lastDate || "(없음)");

// ── 조회할 날짜 범위: 마지막 반영일 다음날 ~ 오늘+40일(미리 고시된 변경 포함) ──
const today = ymd(kst());
let from = log.lastDate ? addDays(log.lastDate, 1) : addDays(today, -FIRST_LOOKBACK_DAYS);
if (from < addDays(today, -FIRST_LOOKBACK_DAYS)) from = addDays(today, -FIRST_LOOKBACK_DAYS);
const to = addDays(today, 40);
const dates = []; for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
console.log(`조회: ${from} ~ ${to} (${dates.length}일)`);

const fetched = []; let fails = 0;
for (let i = 0; i < dates.length; i += 4) {
  const part = dates.slice(i, i + 4);
  const rs = await Promise.all(part.map((d) => changesOn(d).then((it) => ({ d, it })).catch((e) => { fails++; console.log(d, "실패:", e.message); return null; })));
  rs.filter(Boolean).forEach(({ d, it }) => { if (it.length) { console.log(d, it.length, "건"); fetched.push(...it.map((x) => ({ ...x, _d: d }))); } });
  await sleep(300);
}
if (fails > Math.max(3, dates.length * 0.2)) { console.error(`중단: 조회 실패 ${fails}일`); process.exit(1); }

// ── 반영 (적용일이 오늘 이전·당일인 것만 DB에 반영, 미래 적용분은 내역에만 '예정'으로) ──
const newChanges = []; let upd = 0, add = 0, del = 0;
fetched.sort((a, b) => a._d.localeCompare(b._d));
for (const it of fetched) {
  const code = String(it.mdsCd || "").trim();
  if (!/^\d{9}$/.test(code)) continue;
  const price = Number(String(it.mxCprc || "0").replace(/[^\d.]/g, "")) || 0;
  const name = String(it.itmNm || "").trim();
  const company = String(it.mnfEntpNm || "").trim();
  const date = it._d, future = date > today;
  const old = byCode.get(code);
  let type;
  if (it.payTpNm === "삭제") type = old ? "삭제" : null;
  else if (!old) type = price > 0 ? "신규" : null;
  else if (price > 0 && price !== old.p) type = price < old.p ? "인하" : "인상";
  else if (company && !old.e) { old.e = company; }
  if (!type) continue;
  newChanges.push({ date, code, name: name || old?.n || "", company: company || old?.e || "", before: old?.p ?? null, after: type === "삭제" ? null : price, type, planned: future || undefined, ingr: it.gnlNmCd || undefined });
  if (future) continue;
  if (type === "삭제") { byCode.delete(code); del++; }
  else if (type === "신규") { const row = { c: code, n: name, p: price }; if (company) row.e = company; byCode.set(code, row); add++; }
  else { old.p = price; if (company) old.e = company; upd++; }
}

const out = [...byCode.values()].sort((a, b) => String(a.c).localeCompare(String(b.c)));
if (out.length < db.length * 0.9) { console.error(`중단: 품목 수가 ${db.length} → ${out.length}로 크게 줄어듦`); process.exit(1); }

// 내역: 같은 날짜·코드 중복 제거, 과거 '예정'은 이번 결과로 대체, 오래된 것 정리
const key = (c) => `${c.date}|${c.code}|${c.type}`;
const keepFrom = addDays(today, -KEEP_DAYS);
const merged = new Map();
for (const c of log.changes) if (c.date >= keepFrom && !(c.planned && c.date >= from)) merged.set(key(c), c);
for (const c of newChanges) merged.set(key(c), c);
const changes = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));

fs.writeFileSync(DB_FILE, "const DRUG_PRICE_DB=" + JSON.stringify(out) + ";");
fs.writeFileSync(CH_FILE, JSON.stringify({ lastDate: today, updatedAt: new Date().toISOString(), changes }));
console.log(`완료: 품목 ${out.length} · 가격변경 ${upd} · 신규 ${add} · 삭제 ${del} · 변동내역 ${changes.length}건 (예정 포함)`);
