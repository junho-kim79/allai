/**
 * 심평원 약가기준정보 (dgamtCrtrInfoService1.2/getDgamtList) — XML로 받아 JSON으로 변환
 * GET /api/price?itmNm=라베린            제품명으로 조회
 * GET /api/price?adtStaDd=20260901       그날 적용된 약가 변경 전체 (페이지: page, rows≤1000)
 * 필드: mdsCd(보험코드) itmNm mnfEntpNm(업체) mxCprc(상한가) adtStaDd(적용일) payTpNm(급여/삭제)
 *       chgBfMdsCd(변경 전 코드) gnlNmCd(주성분코드) spcGnlTpNm(전문/일반) nomNm unit
 * 키: Vercel 환경변수 API_KEY_HIRA (없으면 API_KEY_MFDS)
 * ※ _type=json을 붙이면 조회가 거부되는 경우가 있어 XML만 사용
 */
const SVC = "https://apis.data.go.kr/B551182/dgamtCrtrInfoService1.2/getDgamtList";

function parseXml(xml) {
  const tag = (s, t) => { const m = s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? m[1] : ""; };
  const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) =>
    Object.fromEntries([...m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(([, k, v]) => [k, dec(v)])));
  return { code: tag(xml, "resultCode"), msg: tag(xml, "resultMsg") || tag(xml, "returnAuthMsg"), total: Number(tag(xml, "totalCount")) || 0, items };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=21600");

  const KEY = process.env.API_KEY_HIRA || process.env.API_KEY_MFDS;
  if (!KEY) return res.status(200).json({ items: [], error: "API 키 미설정 (API_KEY_HIRA)" });

  const page = Math.max(1, Number(req.query.page) || 1);
  const rows = Math.min(Math.max(Number(req.query.rows) || 100, 1), 1000);
  const qs = new URLSearchParams({ serviceKey: KEY, numOfRows: String(rows), pageNo: String(page) });
  for (const k of ["itmNm", "mnfEntpNm", "mdsCd", "adtStaDd", "gnlNmCd"]) if (req.query[k]) qs.set(k, String(req.query[k]));

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(`${SVC}?${qs}`, { signal: ctrl.signal });
    const txt = await r.text();
    if (req.query.debug === "1") return res.status(200).json({ status: r.status, head: txt.slice(0, 1500) });
    const d = parseXml(txt);
    if (d.code && d.code !== "00") return res.status(200).json({ items: [], error: d.msg || d.code });
    if (!d.code && !d.items.length) return res.status(200).json({ items: [], error: d.msg || txt.slice(0, 150), status: r.status });
    return res.status(200).json({ items: d.items, totalCount: d.total, page, rows });
  } catch (e) {
    return res.status(200).json({ items: [], error: String(e) });
  } finally { clearTimeout(t); }
}
