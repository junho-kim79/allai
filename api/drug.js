export default async function handler(req, res) {

const { name } = req.query;

const MFDS_KEY = process.env.API_KEY_MFDS;
const HIRA_KEY = process.env.API_KEY_HIRA;

try{

// 1️⃣ 식약처 검색
const mfds = await fetch(
`https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList
?serviceKey=${MFDS_KEY}
&itemName=${encodeURIComponent(name)}
&pageNo=1
&numOfRows=10
&type=json`
);

const mfdsData = await mfds.json();

let items = mfdsData?.body?.items || [];

// 2️⃣ 결과 없으면 심평원 검색
if(!items.length){

const hira = await fetch(
`https://apis.data.go.kr/B551182/durPrdlstInfoService/getDurPrdlstInfoList
?serviceKey=${HIRA_KEY}
&itemName=${encodeURIComponent(name)}
&pageNo=1
&numOfRows=10
&_type=json`
);

const hiraData = await hira.json();

items = hiraData?.response?.body?.items?.item || [];

}

res.status(200).json({items});

}catch(e){

res.status(500).json({error:e.message});

}

}
