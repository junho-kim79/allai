/**
 * 약가DB(drugPriceDB.js) 월간 자동 갱신
 * - 데이터: 심평원 약가기준정보 → allai.ai.kr/api/price (공공데이터 키는 Vercel에만 있음)
 * - 안전장치: 받아온 품목 수가 기존의 85% 미만이거나 1만 개 미만이면 파일을 바꾸지 않고 실패 처리
 * - 기존 품목은 이름 형식("제품명_(규격)")을 그대로 두고 가격·업체명만 갱신, 새 품목은 추가
 */
import fs from "fs";

const BASE = process.env.PRICE_API || "https://allai.ai.kr/api/price";
const ROWS = 1000;
const OUT = new URL("../drugPriceDB.js", import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getPage(page) {
  for (let t = 1; t <= 4; t++) {
    try {
      const r = await fetch(`${BASE}?page=${page}&rows=${ROWS}&_=${Date.now()}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      return d;
    } catch (e) {
      console.log(`page ${page} 재시도 ${t}: ${e.message}`);
      await sleep(3000 * t);
    }
  }
  throw new Error(`page ${page} 실패`);
}

const pick = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return ""; };

// 기존 DB 읽기
const oldTxt = fs.readFileSync(OUT, "utf8");
const oldArr = JSON.parse(oldTxt.slice(oldTxt.indexOf("["), oldTxt.lastIndexOf("]") + 1).replace(/\];\s*\[$/, "]"));
const oldByCode = new Map(oldArr.map((d) => [String(d.c), d]));
console.log("기존 품목:", oldArr.length);

// 전체 페이지 받기
const first = await getPage(1);
const total = first.totalCount || 0;
const pages = Math.ceil(total / ROWS);
console.log("API 전체:", total, "행 /", pages, "페이지");
if (first.items[0]) console.log("필드 예시:", JSON.stringify(first.items[0]));
const all = [...first.items];
for (let p = 2; p <= pages; p += 3) {
  const batch = await Promise.all([p, p + 1, p + 2].filter((x) => x <= pages).map(getPage));
  batch.forEach((d) => all.push(...d.items));
  await sleep(500);
}

// 보험코드별 최신 적용 행만 (이력 행이 섞여 있어도 오늘 기준 최신 가격)
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
const best = new Map();
for (const it of all) {
  const code = String(pick(it, ["mdsCd", "ediCd", "gnlNmCd", "code"])).trim();
  const price = Number(String(pick(it, ["mxCprc", "maxAmt", "upprLmtAmt", "uplmtAmt", "price"])).replace(/[^\d.]/g, ""));
  const start = String(pick(it, ["adtStaDd", "aplStaDd", "startDd"])).replace(/\D/g, "");
  const end = String(pick(it, ["adtEndDd", "aplEndDd", "endDd"])).replace(/\D/g, "");
  if (!/^\d{9}$/.test(code) || !(price > 0)) continue;
  if (start && start > today) continue;           // 아직 적용 전
  if (end && end < today) continue;               // 이미 끝난 가격
  const prev = best.get(code);
  if (!prev || start > prev.start) best.set(code, { code, price, start, it });
}
console.log("유효 품목:", best.size);

if (best.size < 10000 || best.size < oldArr.length * 0.85) {
  console.error(`중단: 유효 품목 ${best.size}개 (기존 ${oldArr.length}개) — 데이터가 불완전해 보여 파일을 바꾸지 않습니다.`);
  process.exit(1);
}

let changed = 0, added = 0;
const out = [];
for (const { code, price, it } of best.values()) {
  const old = oldByCode.get(code);
  const company = String(pick(it, ["mnfEntpNm", "entpNm", "bizNm"])).trim();
  let name = old?.n;
  if (!name) {
    const nm = String(pick(it, ["itmNm", "itemNm", "prdNm"])).trim();
    const spec = String(pick(it, ["nomNm", "stdNm", "unit", "spec"])).trim();
    name = spec ? `${nm}_(${spec})` : nm;
    added++;
  } else if (old.p !== price) changed++;
  const row = { c: code, n: name, p: price };
  if (company) row.e = company;
  out.push(row);
}
out.sort((a, b) => a.c.localeCompare(b.c));
fs.writeFileSync(OUT, "const DRUG_PRICE_DB=" + JSON.stringify(out) + ";");
console.log(`완료: 총 ${out.length} · 가격 변경 ${changed} · 신규 ${added} · 삭제 ${oldArr.length - (out.length - added)}`);
