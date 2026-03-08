export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const rawName = String(req.query.name || "").trim();

  if (!rawName) {
    return res.status(400).json({ error: "약품명을 입력해주세요" });
  }

  const MFDS_KEY = process.env.API_KEY_MFDS || process.env["API_KEY_MFDS"];
  const HIRA_KEY = process.env.API_KEY_HIRA || process.env["API_KEY_HIRA"];

  if (!MFDS_KEY && !HIRA_KEY) {
    return res.status(500).json({ error: "API 키가 없습니다" });
  }

  // 현장 별칭 보정
  const aliasMap = {
    "트리손키트": "트리손",
    "트리손": "트리손",
    "후루마린": "후루마린",
    "뮤코나": "뮤코나",
    "아미노플라즈마": "아미노플라즈마",
    "케이캡": "케이캡",
    "파리에트": "파리에트",
    "넥시움": "넥시움",
    "라베린": "라베린"
  };

  const searchName = aliasMap[rawName] || rawName;

  // 검색어 변형 후보
  const queryCandidates = Array.from(
    new Set([
      searchName,
      searchName.replace(/\s+/g, ""),
      searchName.replace(/주사제|주사|키트|kit/gi, "").trim(),
      searchName.replace(/정|캡슐|주|액|시럽|키트/gi, "").trim()
    ].filter(Boolean))
  );

  function normalizeText(v) {
    return String(v || "")
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function scoreItem(item, q) {
    const name =
      item.ITEM_NAME ||
      item.itemName ||
      item.prdlstNm ||
      item.bizrnoNm ||
      "";

    const company =
      item.ENTP_NAME ||
      item.entpName ||
      item.entpNm ||
      "";

    const ingredient =
      item.INGR_NAME_KOR ||
      item.ingrNameKor ||
      item.itemIngrNm ||
      "";

    const form =
      item.FORM_CODE_NAME ||
      item.formCodeName ||
      item.dosageFormNm ||
      "";

    const nq = normalizeText(q);
    const nn = normalizeText(name);
    const ni = normalizeText(ingredient);
    const nc = normalizeText(company);
    const nf = normalizeText(form);

    let score = 0;

    if (nn === nq) score += 100;
    if (nn.includes(nq)) score += 60;
    if (ni.includes(nq)) score += 35;
    if (nc.includes(nq)) score += 10;
    if (nf.includes(nq)) score += 5;

    // 주사/키트 검색 보정
    if (/주사|주|키트/i.test(q) && /주|키트|inj|kit/i.test(name + " " + form)) {
      score += 15;
    }

    return score;
  }

  async function fetchJsonOrText(url) {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" }
    });

    const raw = await response.text();

    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return { _raw: raw };
    }
  }

  async function searchMFDS(q) {
    if (!MFDS_KEY) return [];

    const urls = [
      `https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList?serviceKey=${MFDS_KEY}&itemName=${encodeURIComponent(q)}&pageNo=1&numOfRows=20&type=json`,
      `https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService06/getDrugPrdtPrmsnInq06?serviceKey=${MFDS_KEY}&item_name=${encodeURIComponent(q)}&pageNo=1&numOfRows=20&type=json`
    ];

    const results = [];

    for (const url of urls) {
      try {
        const data = await fetchJsonOrText(url);
        if (!data) continue;

        const body = data?.body || data?.response?.body || {};
        const items = body?.items?.item || body?.items || [];

        if (Array.isArray(items)) {
          results.push(...items);
        } else if (items) {
          results.push(items);
        }
      } catch (_) {
        // 무시
      }
    }

    return results.map((item) => ({
      source: "MFDS",
      ITEM_NAME: item.ITEM_NAME || item.itemName || item.item_name || item.prdlstNm || "-",
      ENTP_NAME: item.ENTP_NAME || item.entpName || item.entp_name || item.entpNm || "-",
      INGR_NAME_KOR: item.INGR_NAME_KOR || item.ingrNameKor || item.itemIngrNm || "-",
      FORM_CODE_NAME: item.FORM_CODE_NAME || item.formCodeName || item.dosageFormNm || "-",
      ITEM_PERMIT_DATE: item.ITEM_PERMIT_DATE || item.itemPermitDate || item.permitDate || "-",
      ETC_OTC_CODE: item.ETC_OTC_CODE || item.etcOtcCode || item.etcOtcNm || "-"
    }));
  }

  async function searchHIRA(q) {
    if (!HIRA_KEY) return [];

    const urls = [
      `https://apis.data.go.kr/B551182/durPrdlstInfoService/getDurPrdlstInfoList?serviceKey=${HIRA_KEY}&itemName=${encodeURIComponent(q)}&pageNo=1&numOfRows=20&_type=json`,
      `https://apis.data.go.kr/B551182/medicinesInfoService/getMdcinGrnIdntfcInfoList?serviceKey=${HIRA_KEY}&itemName=${encodeURIComponent(q)}&pageNo=1&numOfRows=20&_type=json`
    ];

    const results = [];

    for (const url of urls) {
      try {
        const data = await fetchJsonOrText(url);
        if (!data) continue;

        const body = data?.response?.body || data?.body || {};
        const items = body?.items?.item || body?.items || [];

        if (Array.isArray(items)) {
          results.push(...items);
        } else if (items) {
          results.push(items);
        }
      } catch (_) {
        // 무시
      }
    }

    return results.map((item) => ({
      source: "HIRA",
      ITEM_NAME: item.ITEM_NAME || item.itemName || item.prdlstNm || item.itemNm || "-",
      ENTP_NAME: item.ENTP_NAME || item.entpName || item.entpNm || "-",
      INGR_NAME_KOR: item.INGR_NAME_KOR || item.ingrNameKor || item.itemIngrNm || "-",
      FORM_CODE_NAME: item.FORM_CODE_NAME || item.formCodeName || item.dosageFormNm || "-",
      ITEM_PERMIT_DATE: item.ITEM_PERMIT_DATE || item.itemPermitDate || "-",
      ETC_OTC_CODE: item.ETC_OTC_CODE || item.etcOtcCode || "-"
    }));
  }

  try {
    let merged = [];

    for (const q of queryCandidates) {
      const [mfdsItems, hiraItems] = await Promise.all([
        searchMFDS(q),
        searchHIRA(q)
      ]);

      merged.push(...mfdsItems, ...hiraItems);
    }

    // 중복 제거
    const dedupMap = new Map();
    for (const item of merged) {
      const key = `${normalizeText(item.ITEM_NAME)}|${normalizeText(item.ENTP_NAME)}`;
      if (!dedupMap.has(key)) {
        dedupMap.set(key, item);
      }
    }

    const uniqueItems = Array.from(dedupMap.values());

    // 점수 부여 후 정렬
    const scored = uniqueItems
      .map((item) => ({
        ...item,
        _score: Math.max(...queryCandidates.map((q) => scoreItem(item, q)))
      }))
      .filter((item) => item._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 30)
      .map(({ _score, ...rest }) => rest);

    return res.status(200).json({
      keyword: rawName,
      normalizedKeyword: searchName,
      totalCount: scored.length,
      items: scored
    });
  } catch (e) {
    return res.status(500).json({
      error: "통합 검색 실패",
      detail: e.message
    });
  }
}
