/**
 * 약품 허가정보 조회 (식약처 공공데이터) — 멈춘 Google Cloud 서버 대체용
 * GET /api/drug?name=노바스크정
 * 응답: { items: [{ ITEM_NAME, ENTP_NAME, ITEM_PERMIT_DATE, ETC_OTC_CODE, INGR_NAME_KOR,
 *                   efcyQesitm, useMethodQesitm, atpnWarnQesitm, depositMethodQesitm }] }
 * 키: Vercel 환경변수 API_KEY_MFDS (없으면 API_KEY_HIRA) — 공공데이터포털 일반 인증키
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800"); // 같은 약은 하루 캐시

  const name = String(req.query.name || "").trim();
  if (!name) return res.status(400).json({ error: "name 파라미터가 필요합니다", items: [] });

  const KEY = process.env.API_KEY_MFDS || process.env.API_KEY_HIRA;
  if (!KEY) return res.status(200).json({ items: [], error: "API 키 미설정 (API_KEY_MFDS)" });
  const key = encodeURIComponent(KEY);
  const q = encodeURIComponent(name);

  const debug = req.query.debug === "1";
  const raw = {};
  const getJson = async (url, ms = 4000, tag = "") => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      const txt = await r.text();
      if (debug) raw[tag] = { status: r.status, head: txt.slice(0, 400) };
      try { return JSON.parse(txt); } catch { return null; } // 키 오류 등은 XML로 옴 → 무시
    } catch (e) { if (debug) raw[tag] = { error: String(e) }; return null; } finally { clearTimeout(t); }
  };
  const pickItems = (data) => {
    const body = data?.body || data?.response?.body || {};
    const it = body?.items?.item ?? body?.items ?? [];
    return Array.isArray(it) ? it : (it ? [it] : []);
  };

  // 1) 의약품 제품 허가정보: 제조사·허가일·전문/일반
  // 2) e약은요: 효능·용법·주의사항·보관법 (일반의약품 위주)
  const [permit, easy] = await Promise.all([
    (async () => {
      // 07이 현재 버전(06은 폐기됨). 혹시 몰라 06도 예비로 시도
      const v7 = await getJson(`https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07?serviceKey=${key}&item_name=${q}&pageNo=1&numOfRows=100&type=json`, 4000, "permit");
      if (pickItems(v7).length) return v7;
      return getJson(`https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService06/getDrugPrdtPrmsnInq06?serviceKey=${key}&item_name=${q}&pageNo=1&numOfRows=100&type=json`, 3000, "permit06");
    })(),
    getJson(`https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList?serviceKey=${key}&itemName=${q}&pageNo=1&numOfRows=50&type=json`, 4000, "easy")
  ]);

  const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
  const easyByName = new Map(pickItems(easy).map((e) => [norm(e.itemName), e]));

  const items = pickItems(permit).map((p) => {
    const nm = p.ITEM_NAME || p.item_name || "";
    const e = easyByName.get(norm(nm)) || {};
    return {
      source: "식약처",
      ITEM_SEQ: p.ITEM_SEQ || "",
      ITEM_NAME: nm,
      ENTP_NAME: p.ENTP_NAME || p.ENTP_NM || "",
      ITEM_PERMIT_DATE: p.ITEM_PERMIT_DATE || p.PRDUCT_PRMISN_DT || "",
      ETC_OTC_CODE: p.ETC_OTC_CODE || p.SPCLTY_PBLC || p.ETC_OTC_NAME || "",
      INGR_NAME_KOR: p.ITEM_INGR_NAME || p.MAIN_ITEM_INGR || "",
      EDI_CODE: p.EDI_CODE || "",
      CANCEL: p.CANCEL_NAME || p.CANCEL_DATE || "",
      efcyQesitm: e.efcyQesitm || "",
      useMethodQesitm: e.useMethodQesitm || "",
      atpnWarnQesitm: e.atpnWarnQesitm || "",
      depositMethodQesitm: e.depositMethodQesitm || ""
    };
  });

  // 허가정보에 없고 e약은요에만 있는 품목도 포함
  const seen = new Set(items.map((i) => norm(i.ITEM_NAME)));
  for (const e of pickItems(easy)) {
    if (seen.has(norm(e.itemName))) continue;
    items.push({
      source: "식약처", ITEM_SEQ: e.itemSeq || "", ITEM_NAME: e.itemName || "", ENTP_NAME: e.entpName || "",
      ITEM_PERMIT_DATE: "", ETC_OTC_CODE: "", INGR_NAME_KOR: "",
      efcyQesitm: e.efcyQesitm || "", useMethodQesitm: e.useMethodQesitm || "",
      atpnWarnQesitm: e.atpnWarnQesitm || "", depositMethodQesitm: e.depositMethodQesitm || ""
    });
  }

  return res.status(200).json(debug ? { items, count: items.length, raw } : { items, count: items.length });
}
