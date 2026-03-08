export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: '약품명을 입력해주세요' });

  const key = process.env.API_KEY_MFDS;
  const url = `https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService05/getDrugPrdtPrmsnDtlInq05?serviceKey=${key}&item_name=${encodeURIComponent(name)}&type=json&numOfRows=20`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const items = data?.body?.items || [];
    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: 'API 호출 실패', detail: e.message });
  }
}
