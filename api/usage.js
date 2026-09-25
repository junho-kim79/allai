/**
 * 심평원 의약품사용정보 (지역별 처방 사용량) — 서비스: B551182/msupUserInfoService1.2
 * 키: Vercel 환경변수 API_KEY_HIRA (없으면 API_KEY_MFDS)
 *
 * mode=raw    (기본) 원본 조회: &diagYm=202412&atcStep4Cd=A02BC&sidoCd=230000&sgguCd=230001
 * mode=latest 데이터가 있는 가장 최근 진료년월
 * mode=sggu   &sido=230000 → 해당 시도의 시군구 목록 [{code,name}]
 * mode=trend  &atc=A02BC&sido=230000&sggu=230006|all&months=12&tp=02 → 월별 합계 + 기관종별
 */
const SVC = "https://apis.data.go.kr/B551182/msupUserInfoService1.2/getAtcStp4AreaList1.2";
const ALLOWED = ["diagYm", "atcStep4Cd", "insupTp", "cpmdPrscTp", "sidoCd", "sgguCd", "numOfRows", "pageNo"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800"); // 월 통계 → 하루 캐시

  const KEY = process.env.API_KEY_HIRA || process.env.API_KEY_MFDS;
  if (!KEY) return res.status(200).json({ error: "API 키 미설정 (API_KEY_HIRA)" });

  const call = async (params, ms = 7000) => {
    const qs = new URLSearchParams({ serviceKey: KEY, _type: "json", numOfRows: "100", pageNo: "1", insupTp: "0", cpmdPrscTp: "02" });
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(`${SVC}?${qs}`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      const txt = await r.text();
      let data; try { data = JSON.parse(txt); } catch {
        const msg = (txt.match(/<returnAuthMsg>([^<]*)</) || txt.match(/<resultMsg>([^<]*)</) || [])[1] || txt.slice(0, 120);
        return { items: [], error: msg };
      }
      const body = data?.response?.body || data?.body || {};
      const it = body?.items?.item ?? body?.items ?? [];
      return { items: Array.isArray(it) ? it : (it ? [it] : []) };
    } catch (e) { return { items: [], error: String(e) }; } finally { clearTimeout(t); }
  };
  const ymList = (endYm, n) => {
    let y = Math.floor(endYm / 100), m = endYm % 100; const out = [];
    for (let i = 0; i < n; i++) { out.unshift(y * 100 + m); m--; if (m === 0) { m = 12; y--; } }
    return out;
  };
  const findLatest = async () => {
    // 최근 24개월을 한 번에 조회해서 데이터가 있는 가장 최근 달 (Vercel 10초 제한 대비 병렬)
    const now = new Date();
    const yms = ymList(now.getFullYear() * 100 + now.getMonth() + 1, 25).slice(0, 24).reverse();
    const rs = await Promise.all(yms.map((ym) => call({ diagYm: ym, atcStep4Cd: "A02BC", sidoCd: "110000", sgguCd: "110001" }, 5000)));
    const i = rs.findIndex((r) => r.items.length);
    return i >= 0 ? yms[i] : null;
  };
  // 시군구 목록: ① 심평원 행정구역 코드표(odcloud) → ② 실패 시 코드 탐색(20개씩 나눠서)
  const CODE_TABLE = "https://api.odcloud.kr/api/15067469/v1/uddi:a19294d7-bd8d-4f39-b276-8742551f2661";
  const codeTable = async () => {
    try {
      const r = await fetch(`${CODE_TABLE}?page=1&perPage=1000&serviceKey=${encodeURIComponent(KEY)}`);
      const d = await r.json();
      return Array.isArray(d?.data) ? d.data : null;
    } catch { return null; }
  };
  const listSggu = async (sido, ym) => {
    const pre = String(sido).slice(0, 2);
    const rows = await codeTable();
    if (rows && rows.length) {
      const pick = (o, ks) => { for (const k of Object.keys(o)) if (ks.some((x) => k.includes(x))) return o[k]; return ""; };
      const list = rows.map((o) => ({ code: String(pick(o, ["코드"]) || "").trim(), name: String(pick(o, ["코드명", "명"]) || "").trim(), kind: String(pick(o, ["구분"]) || "") }))
        .filter((o) => /^\d{6}$/.test(o.code) && o.code.startsWith(pre) && !o.code.endsWith("0000") && /시군구|sggu|시군/i.test(o.kind + "시군구"));
      if (list.length) return list;
    }
    const codes = [];
    for (let i = 1; i <= 45; i++) codes.push(`${pre}${String(i).padStart(4, "0")}`);
    for (let k = 1; k <= 30; k++) for (let j = 0; j <= 3; j++) codes.push(`${pre}${String(k * 100 + j).padStart(4, "0")}`);
    const found = [];
    for (let i = 0; i < codes.length; i += 20) {             // 한꺼번에 많이 부르면 차단됨 → 20개씩
      const part = codes.slice(i, i + 20);
      const rs = await Promise.all(part.map((c) => call({ diagYm: ym, atcStep4Cd: "A02BC", sidoCd: sido, sgguCd: c }, 5000)));
      rs.forEach((r, k) => { if (r.items[0]) found.push({ code: part[k], name: String(r.items[0].sgguCdNm || "") }); });
    }
    return found;
  };
  if (req.query.mode === "codetable") {
    const rows = await codeTable();
    return res.status(200).json({ ok: !!rows, count: rows?.length || 0, sample: (rows || []).filter((o) => JSON.stringify(o).includes("대구") || JSON.stringify(o).includes("구미")).slice(0, 12) });
  }

  const mode = String(req.query.mode || "raw");
  try {
    if (mode === "latest") return res.status(200).json({ latest: await findLatest() });

    if (mode === "sggu") {
      const sido = String(req.query.sido || "230000");
      const ym = Number(req.query.ym) || await findLatest();
      return res.status(200).json({ sido, ym, list: await listSggu(sido, ym) });
    }

    if (mode === "trend") {
      const atc = String(req.query.atc || "A02BC").toUpperCase();
      const sido = String(req.query.sido || "230000");
      const tp = req.query.tp === "01" ? "01" : "02";
      const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 24);
      const endYm = Number(req.query.end) || await findLatest();
      if (!endYm) return res.status(200).json({ error: "최근 데이터 없음" });
      let sgguCodes = String(req.query.sggu || "all");
      let sgguList = null;
      if (sgguCodes === "all") { sgguList = await listSggu(sido, endYm); sgguCodes = sgguList.map((s) => s.code); }
      else sgguCodes = sgguCodes.split(",").slice(0, 45);

      const yms = ymList(endYm, months);
      const jobs = [];
      for (const ym of yms) for (const sg of sgguCodes) jobs.push({ ym, sg });
      const results = await Promise.all(jobs.map((j) => call({ diagYm: j.ym, atcStep4Cd: atc, sidoCd: sido, sgguCd: j.sg, cpmdPrscTp: tp })));

      let atcName = "", sidoName = "";
      const byMonth = Object.fromEntries(yms.map((ym) => [ym, { ym, amt: 0, qty: 0, byType: {} }]));
      const bySggu = {};
      results.forEach((r, i) => {
        const { ym, sg } = jobs[i];
        for (const it of r.items) {
          atcName = atcName || it.atcStep4CdNm || ""; sidoName = sidoName || it.sidoCdNm || "";
          const amt = Number(it.msupUseAmt) || 0, qty = Number(it.totUseQty) || 0;
          const cl = String(it.recuClCd).padStart(2, "0");
          const bm = byMonth[ym]; bm.amt += amt; bm.qty += qty;
          bm.byType[cl] = (bm.byType[cl] || 0) + amt;
          if (ym === endYm) {
            const s = (bySggu[sg] = bySggu[sg] || { code: sg, name: it.sgguCdNm || sg, amt: 0, qty: 0 });
            s.amt += amt; s.qty += qty;
          }
        }
      });
      return res.status(200).json({
        atc, atcName, sido, sidoName, tp, endYm,
        months: yms.map((ym) => byMonth[ym]),
        sggu: Object.values(bySggu).sort((a, b) => b.amt - a.amt),
        calls: jobs.length, errors: results.filter((r) => r.error).length
      });
    }

    // raw
    const params = {};
    for (const k of ALLOWED) if (req.query[k]) params[k] = req.query[k];
    const r = await call(params);
    return res.status(200).json({ items: r.items, error: r.error });
  } catch (e) {
    return res.status(200).json({ error: String(e) });
  }
}
