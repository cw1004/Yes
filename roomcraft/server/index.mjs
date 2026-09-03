// The click gateway.
//
//   GET /go/:bundleId/:slot   log the click, 302 to the affiliate link
//   GET /b/:bundleId          the link-in-bio landing page (six products)
//   GET /api/bundles          list bundles with their economics
//   GET /api/clicks           the raw click log, aggregated per slot
//   POST /api/bundles         build a bundle from a candidate list
//
// The gateway exists so the URL printed in a caption never has to change. The
// video is published once; the destination behind /go/... stays editable.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PORT, PUBLIC_ORIGIN, ROOT, ASSUMPTIONS } from './config.mjs';
import { getBundle, readBundles, writeBundle, logClick, readClicks } from './store.mjs';
import { pickBundle } from './bundle.mjs';
import { convertAll } from './affiliate/index.mjs';

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
};

const html = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
};

const esc = s =>
  String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const won = n => `₩${Number(n).toLocaleString('ko-KR')}`;

export async function buildBundle(candidates, meta = {}) {
  const picked = await pickBundle(candidates);
  const { links, warnings } = await convertAll(picked.slots);

  const id = meta.id ?? `b${Date.now().toString(36)}`;
  const bundle = {
    ...picked,
    id,
    createdAt: new Date().toISOString(),
    warnings,
    landing: `${PUBLIC_ORIGIN}/b/${id}`,
    slots: picked.slots.map(s => ({
      ...s,
      affiliate: links.get(s.url) ?? s.url,
      go: `${PUBLIC_ORIGIN}/go/${id}/${s.slot}`,
    })),
  };
  writeBundle(bundle);
  return bundle;
}

// The page Instagram and TikTok viewers actually reach, since neither makes a
// caption URL clickable. Six entry points, hero first.
function landingPage(bundle) {
  const rows = bundle.slots
    .map(
      s => `
      <li>
        <a href="${esc(s.go)}" rel="sponsored noopener" target="_blank">
          <span class="n">${String(s.slot + 1).padStart(2, '0')}</span>
          <span class="body">
            <span class="t">${esc(s.title)}</span>
            <span class="m">${esc(s.platform)} · ${won(s.price)}${
              s.originalPrice > s.price
                ? ` <s>${won(s.originalPrice)}</s>`
                : ''
            }</span>
          </span>
          <span class="go">열기 ↗</span>
        </a>
      </li>`,
    )
    .join('');

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(bundle.landingTitle)}</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;background:#F0EEE9;color:#191713;font:15px/1.6 "Noto Sans KR",-apple-system,BlinkMacSystemFont,sans-serif;word-break:keep-all}
  main{max-width:520px;margin:0 auto;padding:32px 20px 64px}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.04em;color:#7A756B}
  h1{margin:6px 0 4px;font-size:22px;line-height:1.35}
  .concept{margin:0 0 4px;color:#7A756B;font-size:13px}
  .disclosure{margin:20px 0 0;padding:10px 12px;border-left:2px solid #75542D;background:#FDFCFA;font-size:12px;color:#7A756B}
  ul{list-style:none;margin:24px 0 0;padding:0;border-top:1px solid #D9D5CC}
  li{border-bottom:1px solid #D9D5CC}
  a{display:flex;align-items:center;gap:14px;padding:14px 4px;text-decoration:none;color:inherit}
  a:hover,a:focus-visible{background:#FDFCFA}
  a:focus-visible{outline:1.5px solid #75542D;outline-offset:-2px}
  .n{font:11px "IBM Plex Mono",monospace;color:#7A756B;font-variant-numeric:tabular-nums}
  .body{flex:1;min-width:0}
  .t{display:block;font-size:14px;font-weight:700}
  .m{display:block;font:12px "IBM Plex Mono",monospace;color:#7A756B;font-variant-numeric:tabular-nums}
  s{opacity:.6}
  .go{font:11px "IBM Plex Mono",monospace;color:#7A756B;white-space:nowrap}
  footer{margin-top:28px;font:11px "IBM Plex Mono",monospace;color:#7A756B}
</style></head><body><main>
  <p class="eyebrow">이 영상 속 제품 ${bundle.slots.length}점</p>
  <h1>${esc(bundle.landingTitle)}</h1>
  <p class="concept">${esc(bundle.concept)}</p>
  <p class="disclosure">이 페이지의 링크는 제휴 링크이며, 구매 시 운영자가 일정액의 수수료를 받습니다.</p>
  <ul>${rows}</ul>
  <footer>ROOMCRAFT.WORLD</footer>
</main></body></html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_ORIGIN);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    // ── click gateway ──
    if (req.method === 'GET' && parts[0] === 'go' && parts.length === 3) {
      const [, id, slotRaw] = parts;
      const bundle = getBundle(id);
      const slot = bundle?.slots?.[Number(slotRaw)];
      if (!slot) return json(res, 404, { error: 'unknown bundle or slot' });

      // Logged before the redirect: a failed redirect must not lose the click.
      logClick({
        bundle: id,
        slot: Number(slotRaw),
        productId: slot.id,
        platform: slot.platform,
        ref: req.headers.referer ?? null,
        ua: req.headers['user-agent'] ?? null,
        src: url.searchParams.get('src'), // ?src=reels / shorts / tiktok / pin
      });

      res.writeHead(302, { location: slot.affiliate, 'cache-control': 'no-store' });
      return res.end();
    }

    // ── landing page ──
    if (req.method === 'GET' && parts[0] === 'b' && parts.length === 2) {
      const bundle = getBundle(parts[1]);
      if (!bundle) return html(res, 404, '<p>없는 페이지입니다.</p>');
      return html(res, 200, landingPage(bundle));
    }

    // ── api ──
    if (req.method === 'GET' && url.pathname === '/api/bundles') {
      return json(res, 200, Object.values(readBundles()));
    }

    if (req.method === 'GET' && url.pathname === '/api/clicks') {
      const clicks = readClicks();
      const bySlot = {};
      for (const c of clicks) {
        const k = `${c.bundle}/${c.slot}`;
        bySlot[k] = (bySlot[k] ?? 0) + 1;
      }
      return json(res, 200, { total: clicks.length, bySlot, recent: clicks.slice(-50) });
    }

    if (req.method === 'POST' && url.pathname === '/api/bundles') {
      const body = await new Promise((ok, bad) => {
        let s = '';
        req.on('data', c => (s += c));
        req.on('end', () => {
          try {
            ok(JSON.parse(s || '{}'));
          } catch (e) {
            bad(e);
          }
        });
        req.on('error', bad);
      });
      const candidates =
        body.candidates ??
        JSON.parse(readFileSync(resolve(ROOT, 'server/fixtures/catalog.json'), 'utf8'));
      return json(res, 200, await buildBundle(candidates));
    }

    if (url.pathname === '/health') {
      return json(res, 200, { ok: true, assumptions: ASSUMPTIONS });
    }

    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  server.listen(PORT, () => {
    console.log(`ROOMCRAFT 게이트웨이  ${PUBLIC_ORIGIN}`);
    console.log(`  POST /api/bundles   번들 생성`);
    console.log(`  GET  /b/:id         링크 페이지`);
    console.log(`  GET  /go/:id/:slot  클릭 → 리다이렉트`);
    console.log(`  GET  /api/clicks    클릭 집계`);
  });
}

export { server };
