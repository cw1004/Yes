# -*- coding: utf-8 -*-
"""링크인바이오 페이지 테스트.

인스타·틱톡은 캡션에 링크를 걸 수 없어 프로필 링크 하나로 모든 상품을 연결해야 한다.
이 페이지가 깨지면 두 플랫폼의 조회수는 수익으로 이어지지 않는다.
"""

from __future__ import annotations

import re
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from shopreel.config import Config
from shopreel.models import Product, VideoAsset
from shopreel.store import Store
from shopreel.tracker import serve


def sample(idx: int) -> Product:
    return Product(source="coupang", product_id=f"P{idx}",
                   title=f"코시 접이식 LED 스탠드 {idx}호",
                   url=f"https://link.coupang.com/a/{idx}", price=23900 + idx,
                   orig_price=39900, discount_pct=40, currency="KRW",
                   rank=idx, category="가전디지털", highlights=["로켓배송"])


class LandingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = Config(out_dir=Path(self.tmp.name), watermark="SHOPREEL")
        self.cfg.ensure_dirs()
        self.store = Store(self.cfg.db)

        self.products = [sample(i) for i in (1, 2)]
        for p in self.products:
            self.store.upsert_product(p)
            (self.cfg.video_dir / f"{p.key}.mp4").write_bytes(b"video-bytes")
            (self.cfg.video_dir / f"{p.key}.jpg").write_bytes(b"thumb-from-video")
            self.store.add_video(VideoAsset(product_key=p.key,
                                            path=str(self.cfg.video_dir / f"{p.key}.mp4"),
                                            seconds=30))
            self.store.add_link(f"yt{p.product_id}", p.key, "youtube", p.url)
            self.store.add_link(f"ig{p.product_id}", p.key, "instagram", p.url)

        self.httpd, _ = serve(self.cfg, host="127.0.0.1", port=0, store=self.store)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def get(self, path: str) -> str:
        return urllib.request.urlopen(f"{self.base}{path}").read().decode("utf-8")

    # ---------------------------------------------------------------- 내용
    def test_page_lists_products_with_prices(self):
        html = self.get("/shop")
        self.assertEqual(html.count('class="card"'), 2)
        self.assertIn("코시 접이식 LED 스탠드 1호", html)
        self.assertIn("₩23,901", html)
        self.assertIn("40% OFF", html)
        self.assertIn("₩39,900", html)          # 정가 취소선
        self.assertIn("쿠팡 인기 1위", html)

    def test_disclosure_is_on_the_page(self):
        html = self.get("/shop")
        self.assertIn("제휴 링크를 포함", html)

    def test_links_are_relative_so_any_domain_works(self):
        html = self.get("/shop")
        self.assertNotIn("http://localhost:8787", html)   # 기본 tracker_base 가 새어 나오면 안 됨
        self.assertRegex(html, r'href="/r/[a-zA-Z0-9]+')
        self.assertRegex(html, r'src="/img/[0-9a-f]+\.jpg"')

    def test_platform_attribution(self):
        """?p=instagram 이면 인스타 추적 코드로 연결된다."""
        html = self.get("/shop?p=instagram")
        codes = set(re.findall(r'href="/r/([a-zA-Z0-9]+)', html))
        self.assertTrue(all(c.startswith("ig") for c in codes), codes)
        html = self.get("/shop?p=youtube")
        codes = set(re.findall(r'href="/r/([a-zA-Z0-9]+)', html))
        self.assertTrue(all(c.startswith("yt") for c in codes), codes)

    def test_root_serves_the_same_page(self):
        self.assertIn('class="card"', self.get("/"))

    def test_empty_store_renders_placeholder(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cfg = Config(out_dir=Path(tmp.name))
        cfg.ensure_dirs()
        httpd, _ = serve(cfg, host="127.0.0.1", port=0, store=Store(cfg.db))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            html = urllib.request.urlopen(
                f"http://127.0.0.1:{httpd.server_address[1]}/shop").read().decode()
            self.assertIn("아직 등록된 상품이 없습니다", html)
        finally:
            httpd.shutdown()
            httpd.server_close()

    # ---------------------------------------------------------------- 정적 파일
    def test_product_photo_is_preferred_over_video_thumbnail(self):
        key = self.products[0].key
        served = urllib.request.urlopen(f"{self.base}/img/{key}.jpg").read()
        self.assertEqual(served, b"thumb-from-video")     # 사진이 없으면 썸네일

        (self.cfg.video_dir / f"{key}_photo.jpg").write_bytes(b"clean-product-photo")
        served = urllib.request.urlopen(f"{self.base}/img/{key}.jpg").read()
        self.assertEqual(served, b"clean-product-photo")  # 있으면 사진 우선

    def test_video_is_served_for_graph_api(self):
        key = self.products[0].key
        resp = urllib.request.urlopen(f"{self.base}/v/{key}.mp4")
        self.assertEqual(resp.headers["Content-Type"], "video/mp4")
        self.assertEqual(resp.read(), b"video-bytes")

    def test_path_traversal_is_blocked(self):
        for path in ("/img/..%2f..%2fshopreel.db", "/v/..%2f..%2fshopreel.db",
                     "/img/etc.jpg", "/v/nope.mp4"):
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(f"{self.base}{path}")
            self.assertEqual(ctx.exception.code, 404, path)

    def test_click_through_still_records(self):
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **kw):
                return None
        html = self.get("/shop?p=instagram")
        code = re.search(r'href="/r/([a-zA-Z0-9]+)', html).group(1)
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.build_opener(NoRedirect).open(f"{self.base}/r/{code}?p=instagram")
        self.assertEqual(ctx.exception.code, 302)
        self.assertEqual(self.store.summary(1)["clicks"], 1)
        by_platform = {r["platform"]: r["clicks"] for r in self.store.platform_stats(1)}
        self.assertEqual(by_platform["instagram"], 1)    # 유입 플랫폼이 구분된다
        self.assertEqual(by_platform.get("youtube", 0), 0)


if __name__ == "__main__":
    unittest.main()
