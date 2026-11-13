const MULTI_LABEL_SUFFIXES = new Set([
  // .uk
  'co.uk', 'org.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk', 'ac.uk', 'gov.uk', 'sch.uk', 'nhs.uk', 'mod.uk', 'police.uk', 'nic.uk',
  // .au
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'act.edu.au', 'nsw.edu.au', 'nt.edu.au', 'qld.edu.au', 'sa.edu.au', 'tas.edu.au', 'vic.edu.au', 'wa.edu.au',
  'act.gov.au', 'nsw.gov.au', 'nt.gov.au', 'qld.gov.au', 'sa.gov.au', 'tas.gov.au', 'vic.gov.au', 'wa.gov.au',
  // .nz
  'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'govt.nz', 'geek.nz', 'gen.nz', 'kiwi.nz', 'maori.nz', 'school.nz', 'iwi.nz', 'mil.nz', 'parliament.nz',
  // .jp
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'ad.jp', 'ed.jp', 'go.jp', 'gr.jp', 'lg.jp',
  // .cn
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'mil.cn',
  'ah.cn', 'bj.cn', 'cq.cn', 'fj.cn', 'gd.cn', 'gs.cn', 'gx.cn', 'gz.cn', 'ha.cn', 'hb.cn', 'he.cn', 'hi.cn', 'hk.cn', 'hl.cn', 'hn.cn',
  'jl.cn', 'js.cn', 'jx.cn', 'ln.cn', 'mo.cn', 'nm.cn', 'nx.cn', 'qh.cn', 'sc.cn', 'sd.cn', 'sh.cn', 'sn.cn', 'sx.cn', 'tj.cn', 'tw.cn', 'xj.cn', 'xz.cn', 'yn.cn', 'zj.cn',
  // .hk / .tw / .mo / .sg / .kr
  'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk', 'idv.hk',
  'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw', 'idv.tw', 'ebiz.tw', 'game.tw', 'club.tw',
  'com.mo', 'org.mo', 'net.mo', 'edu.mo', 'gov.mo',
  'com.sg', 'org.sg', 'net.sg', 'edu.sg', 'gov.sg', 'per.sg',
  'co.kr', 'ne.kr', 'or.kr', 're.kr', 'pe.kr', 'go.kr', 'mil.kr', 'ac.kr', 'hs.kr', 'ms.kr', 'es.kr', 'sc.kr', 'kg.kr',
  'seoul.kr', 'busan.kr', 'daegu.kr', 'incheon.kr', 'gwangju.kr', 'daejeon.kr', 'ulsan.kr', 'gyeonggi.kr', 'gangwon.kr',
  'chungbuk.kr', 'chungnam.kr', 'jeonbuk.kr', 'jeonnam.kr', 'gyeongbuk.kr', 'gyeongnam.kr', 'jeju.kr',
  // .in / .pk / .th / .id / .my / .ph / .vn
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'ac.in', 'edu.in', 'res.in', 'gov.in', 'mil.in', 'nic.in',
  'com.pk', 'net.pk', 'org.pk', 'edu.pk', 'gov.pk', 'gob.pk', 'gok.pk', 'gop.pk', 'gos.pk', 'fam.pk', 'biz.pk', 'web.pk',
  'co.th', 'in.th', 'ac.th', 'go.th', 'mi.th', 'or.th', 'net.th',
  'co.id', 'or.id', 'net.id', 'ac.id', 'sch.id', 'go.id', 'mil.id', 'web.id', 'my.id', 'biz.id', 'ponpes.id',
  'com.my', 'net.my', 'org.my', 'edu.my', 'gov.my', 'mil.my', 'name.my',
  'com.ph', 'net.ph', 'org.ph', 'edu.ph', 'gov.ph', 'mil.ph', 'ngo.ph',
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn', 'int.vn', 'ac.vn', 'biz.vn', 'info.vn', 'name.vn', 'pro.vn', 'health.vn',
  // Americas, Africa, Middle East, Europe
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'mil.br', 'art.br', 'blog.br', 'emp.br', 'ind.br', 'inf.br', 'tmp.br', 'tur.br', 'tv.br',
  'com.mx', 'net.mx', 'org.mx', 'gob.mx', 'edu.mx',
  'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'gov.ar', 'edu.ar', 'mil.ar', 'int.ar', 'tur.ar',
  'com.co', 'net.co', 'org.co', 'gov.co', 'edu.co', 'mil.co', 'nom.co',
  'co.za', 'org.za', 'net.za', 'gov.za', 'ac.za', 'edu.za', 'web.za', 'nom.za', 'law.za', 'mil.za',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il', 'muni.il', 'idf.il', 'k12.il',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr', 'gen.tr', 'biz.tr', 'info.tr', 'web.tr', 'av.tr', 'dr.tr', 'bel.tr', 'pol.tr', 'tsk.tr', 'k12.tr', 'bbs.tr', 'name.tr', 'tel.tr', 'tv.tr',
  'com.ru', 'net.ru', 'org.ru', 'pp.ru',
  'com.ua', 'org.ua', 'net.ua', 'gov.ua', 'edu.ua', 'co.ua',
  'com.pl', 'net.pl', 'org.pl', 'gov.pl', 'edu.pl', 'info.pl', 'waw.pl',
  'com.es', 'nom.es', 'org.es', 'gob.es', 'edu.es',
  'asso.fr', 'nom.fr', 'prd.fr', 'tm.fr', 'gouv.fr',
  // Public second-level registries & widely used PSL hosting domains
  'eu.org', 'uk.com', 'us.com', 'eu.com', 'de.com', 'jp.net', 'cn.com', 'co.com', 'ru.com', 'sa.com', 'se.com', 'za.com', 'br.com',
  'uk.net', 'se.net', 'gb.net', 'hu.net', 'jpn.com', 'mex.com', 'in.net', 'gr.com', 'no.com', 'ar.com', 'ae.org', 'us.org',
  'github.io', 'gitlab.io', 'bitbucket.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app',
  'herokuapp.com', 'firebaseapp.com', 'web.app', 'appspot.com', 'cloudfront.net', 'azurewebsites.net',
  'fly.dev', 'onrender.com', 'blogspot.com', 'wordpress.com',
  'blogspot.co.uk', 's3.amazonaws.com', 'compute.amazonaws.com',
]);

// ccTLDs whose second-level labels act universally as public suffixes (*.tld).
const WILDCARD_SECOND_LEVEL_TLDS = new Set(['bd', 'ck', 'fk', 'jm', 'kh', 'mm', 'np', 'pg', 'ye']);

function isIpHost(hostname: string): boolean {
  if (hostname.startsWith('[') || hostname.includes(':')) return true;
  const parts = hostname.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * Returns the registrable domain (eTLD+1) for a hostname.
 * IPv4, IPv6, `localhost`, and single-label hosts are returned whole.
 */
export function registrableDomain(hostname: string): string {
  if (!hostname) return '';
  const trailingDot = hostname.endsWith('.');
  const clean = trailingDot ? hostname.slice(0, -1) : hostname;
  if (!clean || isIpHost(clean)) return hostname;
  const labels = clean.split('.');
  if (labels.length <= 2) return hostname;
  const lower = labels.map((l) => l.toLowerCase());
  const suffix3 = lower.slice(-3).join('.');
  const suffix2 = lower.slice(-2).join('.');
  const tld = lower[lower.length - 1];
  const suffixLabels = MULTI_LABEL_SUFFIXES.has(suffix3)
    ? 3
    : (MULTI_LABEL_SUFFIXES.has(suffix2) || WILDCARD_SECOND_LEVEL_TLDS.has(tld))
      ? 2
      : 1;
  const take = Math.min(labels.length, suffixLabels + 1);
  return labels.slice(-take).join('.') + (trailingDot ? '.' : '');
}

export interface AddressDisplay {
  full: string;
  host: string;
  sub: string;
  domain: string;
  rest: string;
}

export function addressDisplay(value: string): AddressDisplay {
  if (!value || value === 'about:blank') return { full: '', host: '', sub: '', domain: '', rest: '' };
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    const full = url.href;
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const rest = `${url.pathname}${url.search}${url.hash}`;
      const reg = registrableDomain(url.hostname);
      let sub = url.hostname.length > reg.length && url.hostname.endsWith(`.${reg}`)
        ? url.hostname.slice(0, url.hostname.length - reg.length)
        : '';
      if (url.protocol === 'https:' && sub.toLowerCase().startsWith('www.')) sub = sub.slice(4);
      const port = url.port ? `:${url.port}` : '';
      const domain = `${reg}${port}`;
      return { full, host: `${sub}${domain}`, sub, domain, rest: rest === '/' ? '' : rest };
    }
    return { full, host: full, sub: '', domain: full, rest: '' };
  } catch {
    return { full: value, host: value, sub: '', domain: value, rest: '' };
  }
}
