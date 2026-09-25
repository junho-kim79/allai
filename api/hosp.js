/**
 * 심평원 병원정보서비스 — 지역별 요양기관 목록 (개설일자 포함)
 * GET /api/hosp?sido=230000&sggu=230005&page=1&rows=1000
 * GET /api/hosp?mode=new&sido=230000&months=3   → 최근 N개월 신규 개원 (개설일자 기준)
 * 키: Vercel 환경변수 API_KEY_HIRA (없으면 API_KEY_MFDS)
 */
const SVC = "https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=86400"); // 12시간 캐시
  const KEY = process.env.API_KEY_HIRA || process.env.API_KEY_MFDS;
  if (!KEY) return res.status(200).json({ items: [], error: "API 키 미설정" });

  const call = async (params, ms = 8000) => {
    const qs = new URLSearchParams({ serviceKey: KEY, _type: "json", numOfRows: "1000", pageNo: "1", ...params });
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(`${SVC}?${qs}`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      const txt = await r.text();
      if (req.query.debug === "1") return { debug: { status: r.status, head: txt.slice(0, 1200) } };
      let d; try { d = JSON.parse(txt); } catch {
        return { items: [], total: 0, error: (txt.match(/<returnAuthMsg>([^<]*)</) || txt.match(/<resultMsg>([^<]*)</) || [])[1] || txt.slice(0, 150) };
      }
      const body = d?.response?.body || {};
      const it = body?.items?.item ?? [];
      return { items: Array.isArray(it) ? it : (it ? [it] : []), total: Number(body.totalCount) || 0,
        error: d?.response?.header?.resultCode && d.response.header.resultCode !== "00" ? d.response.header.resultMsg : undefined };
    } catch (e) { return { items: [], total: 0, error: String(e) }; } finally { clearTimeout(t); }
  };
  const slim = (h) => ({ name: h.yadmNm, type: h.clCdNm, typeCd: h.clCd, addr: h.addr, tel: h.telno, open: String(h.estbDd || ""),
    sggu: h.sgguCdNm, docs: Number(h.drTotCnt) || 0, x: h.XPos, y: h.YPos });

  const sido = String(req.query.sido || "230000");
  const base = { sidoCd: sido };
  if (req.query.sggu) base.sgguCd = String(req.query.sggu);
  if (req.query.clCd) base.clCd = String(req.query.clCd);

  if (req.query.mode === "new") {
    const months = Math.min(Math.max(Number(req.query.months) || 3, 1), 12);
    const first = await call({ ...base, pageNo: "1" });
    if (first.debug) return res.status(200).json(first.debug);
    if (first.error && !first.items.length) return res.status(200).json({ items: [], error: first.error });
    const pages = Math.min(Math.ceil(first.total / 1000), 12);
    const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => call({ ...base, pageNo: String(i + 2) })));
    const all = [first, ...rest].flatMap((r) => r.items);
    const now = new Date(Date.now() + 9 * 3600e3);
    const from = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
    const fromStr = `${from.getFullYear()}${String(from.getMonth() + 1).padStart(2, "0")}${String(from.getDate()).padStart(2, "0")}`;
    const items = all.map(slim).filter((h) => h.open >= fromStr && !/약국/.test(h.type || "")).sort((a, b) => b.open.localeCompare(a.open));
    return res.status(200).json({ items, scanned: all.length, total: first.total, from: fromStr, months });
  }

  const r = await call({ ...base, pageNo: String(req.query.page || 1), numOfRows: String(Math.min(Number(req.query.rows) || 100, 1000)) });
  if (r.debug) return res.status(200).json(r.debug);
  return res.status(200).json({ items: r.items.map(slim), total: r.total, error: r.error });
}
