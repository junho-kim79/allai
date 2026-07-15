import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function getDrugPriceFromFirestore(itemName) {
  try {
    const cleanName = String(itemName).trim().replace(/_.*/g, '').trim();
    
    let snap = await db.collection('drugPrices').where('cleanName', '==', cleanName).limit(1).get();
    if (!snap.empty) return snap.docs[0].data().price;
    
    return null;
  } catch(e) {
    return null;
  }
}

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

  const queryCandidates = Array.from(
    new Set([
      searchName,
      searchName.replace(/\s+/g, ""),
      searchName.replace(/주사제|주사|키트|kit/gi, "").trim(),
      searchName.replace(/정|캡슐|주|액|시럽|키트/gi, "").trim()
    ].filter(Boolean))
  );

  function normalizeText(v) {
    return String(v || "").replace(/\s+/g, "").toLowerCase();
  }

  function scoreItem(item, q) {
    const name = item.ITEM_NAME || item.itemName || item.prdlstNm || item.bizrnoNm || "";
    const company = item.ENTP_NAME || item.entpName || item.entpNm || "";
    const ingredient = item.INGR_NAME_KOR || item.ingrNameKor || item.itemIngrNm || "";
    const form = item.FORM_CODE_NAME || item.formCodeName || item.dosageFormNm || "";

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
    if (/주사|주|키트/i.test(q) && /주|키트|inj|kit/i.test(name + " " + form)) score += 15;

    return score;
  }

  async function fetchJsonOrText(url) {
    const response = await fetch(url, { method: "GET", headers: { Accept: "application/json, text/plain, */*" } });
    const raw = await response.text();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return { _raw: raw }; }
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
        if (Array.isArray(items)) results.push(...items);
        else if (items) results.push(items);
      } catch (_) {}
    }
    return results.map((item) => ({
      source: "식약처",
      ITEM_NAME: item.ITEM_NAME || item.itemName || item.item_name || item.prdlstNm || "-",
      ENTP_NAME: item.ENTP_NAME || item.entpName || item.entp_name || item.entpNm || "-",
      INGR_NAME_KOR: item.INGR_NAME_KOR || item.ingrNameKor || item.itemIngrNm || "-",
      FORM_CODE_NAME: item.FORM_CODE_NAME || item.formCodeName || item.dosageFormNm || "-",
      ITEM_PERMIT_DATE: item.ITEM_PERMIT_DATE || item.itemPermitDate || item.permitDate || "-",
      ETC_OTC_CODE: item.ETC_OTC_CODE || item.etcOtcCode || item.etcOtcNm || "-",
      efcyQesitm: item.efcyQesitm || "",
      useMethodQesitm: item.useMethodQesitm || "",
      atpnWarnQesitm: item.atpnWarnQesitm || "",
      depositMethodQesitm: item.depositMethodQesitm || ""
    }));
  }

  async function searchHIRA(q) {
