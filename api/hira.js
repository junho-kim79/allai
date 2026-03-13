export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*')

  const { name } = req.query
  if (!name) return res.status(400).json({ error: '약품명을 입력하세요' })

  const key = process.env.API_KEY_HIRA

  const url =
  `https://apis.data.go.kr/B551182/drugInfoService/getDrugList
  ?serviceKey=${key}
  &itemName=${encodeURIComponent(name)}
  &pageNo=1
  &numOfRows=20
  &_type=json`

  try {

    const response = await fetch(url)
    const data = await response.json()

    const items = data?.response?.body?.items?.item || []

    const result = items.map(i => ({
      name: i.itemName,
      company: i.entpName,
      ediCode: i.ediCode,
      price: i.amt
    }))

    res.status(200).json({ items: result })

  } catch (e) {

    res.status(500).json({
      error: "HIRA API 실패",
      detail: e.message
    })

  }

}
