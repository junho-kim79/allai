/**
 * 심평원 의약품사용정보 (지역별 처방 사용량) — 서비스: B551182/msupUserInfoService1.2
 * 키: Vercel 환경변수 API_KEY_HIRA (없으면 API_KEY_MFDS)
 *
 * mode=raw    (기본) 원본 조회: &diagYm=202412&atcStep4Cd=A02BC&sidoCd=230000&sgguCd=230001
 * mode=latest 데이터가 있는 가장 최근 진료년월
 * mode=sggu   &sido=230000 → 해당 시도의 시군구 목록 [{code,name}]
 * mode=trend  &atc=A02BC&sido=230000&sggu=230006|all&months=12&tp=02 → 월별 합계 + 기관종별
 */
const BASE = "https://apis.data.go.kr/B551182/msupUserInfoService1.2/";
const SVC = BASE + "getAtcStp4AreaList1.2";
const ALLOWED = ["diagYm", "atcStep4Cd", "insupTp", "cpmdPrscTp", "sidoCd", "sgguCd", "numOfRows", "pageNo"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800"); // 월 통계 → 하루 캐시

  const KEY = process.env.API_KEY_HIRA || process.env.API_KEY_MFDS;
  if (!KEY) return res.status(200).json({ error: "API 키 미설정 (API_KEY_HIRA)" });

  const call = async (params, ms = 7000, op) => {
    const qs = new URLSearchParams({ serviceKey: KEY, _type: "json", numOfRows: "100", pageNo: "1", insupTp: "0", cpmdPrscTp: "02" });
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(`${op ? BASE + op : SVC}?${qs}`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      const txt = await r.text();
      let data; try { data = JSON.parse(txt); } catch {
        const msg = (txt.match(/<returnAuthMsg>([^<]*)</) || txt.match(/<resultMsg>([^<]*)</) || [])[1] || txt.slice(0, 120);
        return { items: [], error: msg, raw: txt.slice(0, 160) };
      }
      const body = data?.response?.body || data?.body || {};
      const it = body?.items?.item ?? body?.items ?? [];
      const hd = data?.response?.header || data?.header || {};
      return { items: Array.isArray(it) ? it : (it ? [it] : []), rc: hd.resultCode, rm: hd.resultMsg, total: body?.totalCount, raw: txt.slice(0, 160) };
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
    // 성분별 조회 기능 이름 찾기 (진단용): /api/usage?mode=probe&drug=파리에트
    if (mode === "probe") {
      res.setHeader("Cache-Control", "no-store");
      const drug = String(req.query.drug || "파리에트");
      let gnl = String(req.query.gnl || "");
      if (!gnl) {
        try {
          const x = await (await fetch(`https://apis.data.go.kr/B551182/dgamtCrtrInfoService1.2/getDgamtList?serviceKey=${KEY}&numOfRows=5&pageNo=1&itmNm=${encodeURIComponent(drug)}`)).text();
          gnl = (x.match(/<gnlNmCd>([^<]+)</) || [])[1] || "";
        } catch {}
      }
      const ym = Number(req.query.ym) || await findLatest();
      const ops = String(req.query.ops || "getCmpnAreaList1.2,getCmpnSgguList1.2,getGnlNmCdAreaList1.2,getCmpnAreaList,getAtcStp4AreaList1.2").split(",");
      const sg = String(req.query.sggu || "230005");
      const vars = [{ gnlNmCd: gnl, sidoCd: "230000", sgguCd: sg }, { gnlNmCd: gnl.slice(0, 4), sidoCd: "230000", sgguCd: sg }, { cmpnCd: gnl, sidoCd: "230000", sgguCd: sg }, { atcStep4Cd: "A02BC", sidoCd: "230000", sgguCd: sg }];
      const jobs = []; for (const op of ops) for (const v of vars) jobs.push({ op, v });
      const rs = await Promise.all(jobs.map((j) => call({ diagYm: ym, ...j.v }, 8000, j.op)));
      return res.status(200).json({ drug, gnlNmCd: gnl, ym,
        results: jobs.map((j, i) => ({ op: j.op, param: Object.entries(j.v).filter(([k]) => !/sido|sggu/.test(k)).map(([k, v]) => `${k}=${v}`).join("&"), n: rs[i].items.length,
          rc: rs[i].rc, rm: rs[i].rm, err: rs[i].error ? String(rs[i].error).slice(0, 80) : undefined,
          raw: rs[i].items.length ? undefined : rs[i].raw, sample: rs[i].items[0] })).sort((a, b) => b.n - a.n) });
    }
    if (mode === "latest") return res.status(200).json({ latest: await findLatest() });

    if (mode === "sggu") {
      const sido = String(req.query.sido || "230000");
      const ym = Number(req.query.ym) || await findLatest();
      return res.status(200).json({ sido, ym, list: await listSggu(sido, ym) });
    }

    if (mode === "trend") {
      const atc = String(req.query.atc || "A02BC").toUpperCase();
      // 성분(주성분코드) 모드: &gnl=222201ATE,222202ATE (최대 6개, 함량·제형별 코드 합산)
      const gnls = String(req.query.gnl || "").toUpperCase().split(",").filter((g) => /^[0-9A-Z]{9}$/.test(g)).slice(0, 6);
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
      if (gnls.length) { for (const ym of yms) for (const sg of sgguCodes) for (const g of gnls) jobs.push({ ym, sg, g }); }
      else for (const ym of yms) for (const sg of sgguCodes) jobs.push({ ym, sg });
      // 심평원이 한꺼번에 많이 부르면 일부를 거절함 → 동시 10개로 제한 + 실패한 것만 최대 2번 재시도
      const one = (j) => j.g
        ? call({ diagYm: j.ym, gnlNmCd: j.g, sidoCd: sido, sgguCd: j.sg, cpmdPrscTp: tp }, 7000, "getCmpnAreaList1.2")
        : call({ diagYm: j.ym, atcStep4Cd: atc, sidoCd: sido, sgguCd: j.sg, cpmdPrscTp: tp });
      const results = new Array(jobs.length);
      const t0 = Date.now();
      for (let round = 0; round < 3; round++) {
        const todo = jobs.map((_, i) => i).filter((i) => !results[i] || results[i].error);
        if (!todo.length || (round && Date.now() - t0 > 6500)) break;
        if (round) await new Promise((r) => setTimeout(r, 400 * round));
        let k = 0;
        await Promise.all(Array.from({ length: Math.min(10, todo.length) }, async () => {
          while (k < todo.length) { const i = todo[k++]; results[i] = await one(jobs[i]); }
        }));
      }

      let atcName = "", sidoName = "";
      const byMonth = Object.fromEntries(yms.map((ym) => [ym, { ym, amt: 0, qty: 0, byType: {} }]));
      const bySggu = {};
      results.forEach((r, i) => {
        const { ym, sg } = jobs[i];
        for (const it of r.items) {
          atcName = atcName || it.atcStep4CdNm || it.gnlNmCdNm || ""; sidoName = sidoName || it.sidoCdNm || "";
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
