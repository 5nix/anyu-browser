/** Cloudflare sites with a known city and IANA time zone. Unknown sites are never guessed. */
export interface ColoSite {
  city: string;
  cityZh: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

// code: city, 城市, country, latitude, longitude, time zone
const SITES = `
NRT Tokyo 东京 JP 35.68 139.69 Asia/Tokyo
KIX Osaka 大阪 JP 34.69 135.50 Asia/Tokyo
FUK Fukuoka 福冈 JP 33.59 130.40 Asia/Tokyo
OKA Naha 那霸 JP 26.21 127.68 Asia/Tokyo
ICN Seoul 首尔 KR 37.57 126.98 Asia/Seoul
HKG Hong_Kong 香港 HK 22.32 114.17 Asia/Hong_Kong
MFM Macau 澳门 MO 22.20 113.54 Asia/Macau
TPE Taipei 台北 TW 25.03 121.57 Asia/Taipei
KHH Kaohsiung 高雄 TW 22.63 120.30 Asia/Taipei
SIN Singapore 新加坡 SG 1.35 103.82 Asia/Singapore
KUL Kuala_Lumpur 吉隆坡 MY 3.14 101.69 Asia/Kuala_Lumpur
BKK Bangkok 曼谷 TH 13.76 100.50 Asia/Bangkok
SGN Ho_Chi_Minh_City 胡志明市 VN 10.82 106.63 Asia/Ho_Chi_Minh
HAN Hanoi 河内 VN 21.03 105.85 Asia/Ho_Chi_Minh
MNL Manila 马尼拉 PH 14.60 120.98 Asia/Manila
CGK Jakarta 雅加达 ID -6.21 106.85 Asia/Jakarta
BOM Mumbai 孟买 IN 19.08 72.88 Asia/Kolkata
DEL New_Delhi 新德里 IN 28.61 77.21 Asia/Kolkata
MAA Chennai 金奈 IN 13.08 80.27 Asia/Kolkata
BLR Bengaluru 班加罗尔 IN 12.97 77.59 Asia/Kolkata
KHI Karachi 卡拉奇 PK 24.86 67.01 Asia/Karachi
DAC Dhaka 达卡 BD 23.81 90.41 Asia/Dhaka
SYD Sydney 悉尼 AU -33.87 151.21 Australia/Sydney
MEL Melbourne 墨尔本 AU -37.81 144.96 Australia/Melbourne
BNE Brisbane 布里斯班 AU -27.47 153.03 Australia/Brisbane
PER Perth 珀斯 AU -31.95 115.86 Australia/Perth
ADL Adelaide 阿德莱德 AU -34.93 138.60 Australia/Adelaide
AKL Auckland 奥克兰 NZ -36.85 174.76 Pacific/Auckland
LHR London 伦敦 GB 51.51 -0.13 Europe/London
MAN Manchester 曼彻斯特 GB 53.48 -2.24 Europe/London
EDI Edinburgh 爱丁堡 GB 55.95 -3.19 Europe/London
DUB Dublin 都柏林 IE 53.35 -6.26 Europe/Dublin
AMS Amsterdam 阿姆斯特丹 NL 52.37 4.90 Europe/Amsterdam
FRA Frankfurt 法兰克福 DE 50.11 8.68 Europe/Berlin
DUS Düsseldorf 杜塞尔多夫 DE 51.23 6.77 Europe/Berlin
HAM Hamburg 汉堡 DE 53.55 9.99 Europe/Berlin
MUC Munich 慕尼黑 DE 48.14 11.58 Europe/Berlin
TXL Berlin 柏林 DE 52.52 13.40 Europe/Berlin
BER Berlin 柏林 DE 52.52 13.40 Europe/Berlin
CDG Paris 巴黎 FR 48.86 2.35 Europe/Paris
MRS Marseille 马赛 FR 43.30 5.37 Europe/Paris
BRU Brussels 布鲁塞尔 BE 50.85 4.35 Europe/Brussels
LUX Luxembourg 卢森堡 LU 49.61 6.13 Europe/Luxembourg
ZRH Zurich 苏黎世 CH 47.38 8.54 Europe/Zurich
GVA Geneva 日内瓦 CH 46.20 6.14 Europe/Zurich
VIE Vienna 维也纳 AT 48.21 16.37 Europe/Vienna
PRG Prague 布拉格 CZ 50.08 14.44 Europe/Prague
WAW Warsaw 华沙 PL 52.23 21.01 Europe/Warsaw
BUD Budapest 布达佩斯 HU 47.50 19.04 Europe/Budapest
OTP Bucharest 布加勒斯特 RO 44.43 26.10 Europe/Bucharest
SOF Sofia 索非亚 BG 42.70 23.32 Europe/Sofia
ATH Athens 雅典 GR 37.98 23.73 Europe/Athens
IST Istanbul 伊斯坦布尔 TR 41.01 28.98 Europe/Istanbul
MAD Madrid 马德里 ES 40.42 -3.70 Europe/Madrid
BCN Barcelona 巴塞罗那 ES 41.39 2.17 Europe/Madrid
LIS Lisbon 里斯本 PT 38.72 -9.14 Europe/Lisbon
MXP Milan 米兰 IT 45.46 9.19 Europe/Rome
FCO Rome 罗马 IT 41.90 12.50 Europe/Rome
CPH Copenhagen 哥本哈根 DK 55.68 12.57 Europe/Copenhagen
ARN Stockholm 斯德哥尔摩 SE 59.33 18.07 Europe/Stockholm
OSL Oslo 奥斯陆 NO 59.91 10.75 Europe/Oslo
HEL Helsinki 赫尔辛基 FI 60.17 24.94 Europe/Helsinki
KBP Kyiv 基辅 UA 50.45 30.52 Europe/Kyiv
DME Moscow 莫斯科 RU 55.76 37.62 Europe/Moscow
LED Saint_Petersburg 圣彼得堡 RU 59.93 30.34 Europe/Moscow
TLV Tel_Aviv 特拉维夫 IL 32.09 34.78 Asia/Jerusalem
DXB Dubai 迪拜 AE 25.20 55.27 Asia/Dubai
DOH Doha 多哈 QA 25.29 51.53 Asia/Qatar
RUH Riyadh 利雅得 SA 24.71 46.68 Asia/Riyadh
JNB Johannesburg 约翰内斯堡 ZA -26.20 28.05 Africa/Johannesburg
CPT Cape_Town 开普敦 ZA -33.92 18.42 Africa/Johannesburg
LOS Lagos 拉各斯 NG 6.52 3.38 Africa/Lagos
NBO Nairobi 内罗毕 KE -1.29 36.82 Africa/Nairobi
CAI Cairo 开罗 EG 30.04 31.24 Africa/Cairo
IAD Ashburn 阿什本 US 39.04 -77.49 America/New_York
EWR Newark 纽瓦克 US 40.74 -74.17 America/New_York
JFK New_York 纽约 US 40.71 -74.01 America/New_York
BOS Boston 波士顿 US 42.36 -71.06 America/New_York
ATL Atlanta 亚特兰大 US 33.75 -84.39 America/New_York
MIA Miami 迈阿密 US 25.76 -80.19 America/New_York
ORD Chicago 芝加哥 US 41.88 -87.63 America/Chicago
DFW Dallas 达拉斯 US 32.78 -96.80 America/Chicago
IAH Houston 休斯敦 US 29.76 -95.37 America/Chicago
MSP Minneapolis 明尼阿波利斯 US 44.98 -93.27 America/Chicago
DEN Denver 丹佛 US 39.74 -104.99 America/Denver
PHX Phoenix 凤凰城 US 33.45 -112.07 America/Phoenix
LAX Los_Angeles 洛杉矶 US 34.05 -118.24 America/Los_Angeles
SJC San_Jose 圣何塞 US 37.34 -121.89 America/Los_Angeles
SFO San_Francisco 旧金山 US 37.77 -122.42 America/Los_Angeles
SEA Seattle 西雅图 US 47.61 -122.33 America/Los_Angeles
PDX Portland 波特兰 US 45.52 -122.68 America/Los_Angeles
LAS Las_Vegas 拉斯维加斯 US 36.17 -115.14 America/Los_Angeles
HNL Honolulu 檀香山 US 21.31 -157.86 Pacific/Honolulu
YYZ Toronto 多伦多 CA 43.65 -79.38 America/Toronto
YUL Montreal 蒙特利尔 CA 45.50 -73.57 America/Toronto
YVR Vancouver 温哥华 CA 49.28 -123.12 America/Vancouver
YYC Calgary 卡尔加里 CA 51.05 -114.07 America/Edmonton
MEX Mexico_City 墨西哥城 MX 19.43 -99.13 America/Mexico_City
GRU São_Paulo 圣保罗 BR -23.55 -46.63 America/Sao_Paulo
GIG Rio_de_Janeiro 里约热内卢 BR -22.91 -43.17 America/Sao_Paulo
EZE Buenos_Aires 布宜诺斯艾利斯 AR -34.60 -58.38 America/Argentina/Buenos_Aires
SCL Santiago 圣地亚哥 CL -33.45 -70.67 America/Santiago
BOG Bogotá 波哥大 CO 4.71 -74.07 America/Bogota
LIM Lima 利马 PE -12.05 -77.04 America/Lima
`;

export const COLO_SITES: Readonly<Record<string, ColoSite>> = Object.fromEntries(SITES.trim().split('\n').map((line) => {
  const [code, city, cityZh, country, latitude, longitude, timezone] = line.split(' ');
  return [code, { city: city.replaceAll('_', ' '), cityZh, country, latitude: Number(latitude), longitude: Number(longitude), timezone }];
}));

/** The site only when it lies in the measured country; a mismatch means no city is proposed. */
export function coloForCountry(code: string, country: string): ColoSite | null {
  const site = COLO_SITES[code.toUpperCase()];
  return site && site.country === country.toUpperCase() ? site : null;
}
