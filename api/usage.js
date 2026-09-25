/**
 * 심평원 의약품사용정보 (지역별 처방 사용량)
 * GET /api/usage?op=getAtcStp4AreaList1.2&diagYm=202506&atcStep4Cd=A02BC&sidoCd=230000
 * 키: Vercel 환경변수 API_KEY_HIRA (없으면 API_KEY_MFDS)
 * 서비스: https://apis.data.go.kr/B551182/msupUserInfoService1.2
 */
const ALLOWED_PARAMS = ["diagYm", "atcStep4Cd", "atcStep3Cd", "gnlNmCd", "insupTp", "cpmdPrscTp",
  "sidoCd", "sgguCd", "clCd", "numOfRows", "pageNo", "startYm", "endYm"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800"); // 월 단위 통계 → 하루 캐시

  const op = String(req.query.op || "getAtcStp4AreaList1.2");
  if (!/^get[A-Za-z0-9]+List1\.2$/.test(op)) return res.status(400).json({ error: "허용되지 않은 op", items: [] });

  const KEY = process.env.API_KEY_HIRA || process.env.API_KEY_MFDS;
  if (!KEY) return res.status(200).json({ items: [], error: "API 키 미설정 (API_KEY_HIRA)" });

  const qs = new URLSearchParams({ serviceKey: KEY, _type: "json", numOfRows: "100", pageNo: "1" });
  for (const k of ALLOWED_PARAMS) if (req.query[k]) qs.set(k, String(req.query[k]));

  const url = `https://apis.data.go.kr/B551182/msupUserInfoService1.2/${op}?${qs.toString()}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    const txt = await r.text();
    let data = null;
    try { data = JSON.parse(txt); } catch {}
    if (!data) {
      // 승인 전·키 오류 등은 XML로 옴 → 원인 메시지만 뽑아서 전달
      const msg = (txt.match(/<returnAuthMsg>([^<]*)</) || txt.match(/<resultMsg>([^<]*)</) || [])[1] || txt.slice(0, 200);
      return res.status(200).json({ items: [], error: msg, status: r.status });
    }
    const body = data?.response?.body || data?.body || {};
    const it = body?.items?.item ?? body?.items ?? [];
    const items = Array.isArray(it) ? it : (it ? [it] : []);
    return res.status(200).json({ items, totalCount: body.totalCount ?? items.length,
      resultMsg: data?.response?.header?.resultMsg || data?.header?.resultMsg || "" });
  } catch (e) {
    return res.status(200).json({ items: [], error: String(e) });
  } finally { clearTimeout(t); }
}
