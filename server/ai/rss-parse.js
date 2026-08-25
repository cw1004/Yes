'use strict';
/**
 * 아주 작은 RSS/Atom 파서. 외부 패키지 없이 헤드라인만 안전하게 뽑는다.
 * 완전한 XML 파서가 아니라, 피드에서 필요한 필드만 추출하는 목적에 맞춘 구현이다.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ', '#160': ' ',
};

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+|#\d+);/gi, (m, name) => (ENTITIES[name.toLowerCase()] !== undefined ? ENTITIES[name.toLowerCase()] : m));
}

function safeChar(code) {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** 태그 안의 텍스트 추출 (CDATA 포함) */
function tagText(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return clean(m[1]);
}

function clean(raw) {
  // 태그 제거 → 엔티티 복원 → 한 번 더 태그 제거.
  // 피드가 &lt;p&gt; 처럼 인코딩해 보낸 마크업까지 걷어내기 위함이다.
  const stripped = String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Atom 의 <link href="..."/> 형태까지 처리 */
function extractLink(block) {
  const rss = tagText(block, 'link');
  if (rss && /^https?:/i.test(rss)) return rss;
  const atom = block.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*\/?>/i);
  if (atom) {
    // rel="alternate" 를 우선하되 없으면 첫 링크
    const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*\shref=["']([^"']+)["']/i)
      || block.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*rel=["']alternate["']/i);
    return decodeEntities((alt || atom)[1]);
  }
  const guid = tagText(block, 'guid');
  return /^https?:/i.test(guid) ? guid : '';
}

function parseDate(block) {
  for (const tag of ['pubDate', 'published', 'updated', 'dc:date']) {
    const v = tagText(block, tag);
    if (!v) continue;
    const t = Date.parse(v);
    if (!isNaN(t)) return t;
  }
  return null;
}

/**
 * RSS <item> 또는 Atom <entry> 를 기사 배열로.
 * @returns {Array<{title:string,link:string,publishedAt:number|null,summary:string}>}
 */
function parseFeed(xml) {
  const text = String(xml || '');
  const blocks = text.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
  const out = [];
  for (const block of blocks) {
    const title = tagText(block, 'title');
    const link = extractLink(block);
    if (!title || !link) continue;
    out.push({
      title,
      link,
      publishedAt: parseDate(block),
      summary: tagText(block, 'description') || tagText(block, 'summary') || tagText(block, 'content'),
    });
  }
  return out;
}

module.exports = { XMLParserLite: { parseFeed }, decodeEntities, clean, parseFeed };
