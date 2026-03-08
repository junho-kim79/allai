export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: '약품명을 입력해주세요' });

  const key = process.env.API_KEY_MFDS;
  
  // e약은요 API (일반의약품 개요정보)
  const url = `https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList?serviceKey=${key}&itemName=${encodeURIComponent(name)}&type=json&numOfRows=20&pageNo=1`;

  try {
    const response = await fetch(url);
    const text = await response.text();
    
    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      return res.status(200).json({ items: [], debug: text.substring(0, 300) });
    }

    const body = data?.body || data?.response?.body || {};
    const items = body?.items || [];
    const list = Array.isArray(items) ? items : (items.item ? [].concat(items.item) : []);
    
    res.status(200).json({ items: list, totalCount: body?.totalCount || 0 });

  } catch (e) {
    res.status(500).json({ error: 'API 호출 실패', detail: e.message });
  }
}
