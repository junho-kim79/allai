/**
 * 심평원 약가기준정보 (보험코드·제품명·업체명·상한금액)
 * GET /api/price?itmNm=라베린            → 제품명으로 조회
 * GET /api/price?page=1&rows=1000        → 전체 목록 페이지 단위 (매달 자동 갱신 작업이 사용)
 * 키: Vercel 환경변수 API_KEY_HIRA (없으면 API_KEY_MFDS)
 */
const SVC = "https://apis.data.go.kr/B551182/dgamtCrtrInfoService1.2/getDgamtList";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=21600"); // 6시간 캐시

  const KEY = process.env.API_KEY_HIRA || process.env.API_KEY_MFDS;
  if (!KEY) return res.status(200).json({ items: [], error: "API 키 미설정 (API_KEY_HIRA)" });

  const page = Math.max(1, Number(req.query.page) || 1);
  const rows = Math.min(Math.max(Number(req.query.rows) || 100, 1), 1000);
  const qs = new URLSearchParams({ serviceKey: KEY, _type: "json", numOfRows: String(rows), pageNo: String(page) });
  for (const k of ["itmNm", "mnfEntpNm", "mdsCd", "adtStaDd"]) if (req.query[k]) qs.set(k, String(req.query[k]));

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(`${SVC}?${qs}`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch {
      const msg = (txt.match(/<returnAuthMsg>([^<]*)</) || txt.match(/<resultMsg>([^<]*)</) || [])[1] || txt.slice(0, 200);
      return res.status(200).json({ items: [], error: msg, status: r.status });
    }
    const body = data?.response?.body || data?.body || {};
    const it = body?.items?.item ?? body?.items ?? [];
    const items = Array.isArray(it) ? it : (it ? [it] : []);
    return res.status(200).json({ items, totalCount: Number(body.totalCount) || items.length, page, rows,
      resultMsg: data?.response?.header?.resultMsg || "" });
  } catch (e) {
    return res.status(200).json({ items: [], error: String(e) });
  } finally { clearTimeout(t); }
}
