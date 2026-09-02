# -*- coding: utf-8 -*-
"""쿠팡 파트너스 소스 테스트.

실제 키 없이도 검증할 수 있도록, 요청 서명을 실제로 재계산해 확인하는
목 서버(tools/mock_coupang.py)를 띄워 코드 경로를 그대로 태운다.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
import unittest
from typing import Dict, List

from shopreel.affiliate import build_link
from shopreel.config import Config
from shopreel.scriptgen import build_script_template, proof_badge
from shopreel.sources.base import SourceError
from shopreel.sources.coupang import CoupangSource, authorization, deeplink
from tools.mock_coupang import MockHandler, start, verify_signature

ACCESS, SECRET = "test-access", "test-secret"


class SignatureTest(unittest.TestCase):
    def test_cea_header_matches_manual_hmac(self):
        fixed = time.gmtime(1767225600)          # 2026-01-01 00:00:00 UTC
        path = "/v2/providers/affiliate_open_api/apis/openapi/v1/products/goldbox"
        query = "limit=10"
        header = authorization("GET", path, query, ACCESS, SECRET, now=fixed)

        signed_date = time.strftime("%y%m%dT%H%M%SZ", fixed)
        expected = hmac.new(SECRET.encode(),
                            f"{signed_date}GET{path}{query}".encode(),
                            hashlib.sha256).hexdigest()
        self.assertIn("CEA algorithm=HmacSHA256", header)
        self.assertIn(f"access-key={ACCESS}", header)
        self.assertIn(f"signed-date={signed_date}", header)
        self.assertIn(f"signature={expected}", header)

    def test_query_is_part_of_signature(self):
        fixed = time.gmtime(1767225600)
        path = "/v2/x"
        a = authorization("GET", path, "limit=10", ACCESS, SECRET, now=fixed)
        b = authorization("GET", path, "limit=20", ACCESS, SECRET, now=fixed)
        self.assertNotEqual(a, b)

    def test_verifier_rejects_wrong_secret(self):
        fixed = time.gmtime(1767225600)
        header = authorization("GET", "/p", "q=1", ACCESS, "다른비밀", now=fixed)
        ok, why = verify_signature(header, "GET", "/p", "q=1", ACCESS, SECRET)
        self.assertFalse(ok)
        self.assertIn("signature", why)


class MockServerTestCase(unittest.TestCase):
    """목 서버를 띄우고 환경변수를 세팅하는 공통 베이스."""

    def setUp(self):
        self.httpd, self.base, self.handler = start(ACCESS, SECRET)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self._saved = {k: os.environ.get(k) for k in
                       ("COUPANG_ACCESS_KEY", "COUPANG_SECRET_KEY", "COUPANG_API_HOST",
                        "COUPANG_CATEGORY_ID", "COUPANG_SUBID", "COUPANG_ENDPOINT")}
        os.environ.update({"COUPANG_ACCESS_KEY": ACCESS, "COUPANG_SECRET_KEY": SECRET,
                           "COUPANG_API_HOST": self.base, "COUPANG_CATEGORY_ID": "1016",
                           "COUPANG_SUBID": "shopreel"})
        os.environ.pop("COUPANG_ENDPOINT", None)

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class FetchTest(MockServerTestCase):
    def test_fetch_parses_coupang_response(self):
        items = CoupangSource().fetch(Config(), 5)
        self.assertEqual(len(items), 5)
        top = items[0]
        self.assertEqual(top.source, "coupang")
        self.assertEqual(top.currency, "KRW")
        self.assertEqual(top.rank, 1)
        self.assertEqual(top.price, 129000)
        self.assertEqual(top.discount, 31)          # 쿠팡이 준 discountRate 를 그대로 쓴다
        self.assertEqual(top.price_text(), "₩129,000")
        self.assertIn("로켓배송", top.highlights)
        self.assertTrue(top.image_url.endswith(".jpg"))

    def test_signature_verified_on_every_call(self):
        CoupangSource().fetch(Config(), 3)
        self.assertTrue(self.handler.calls)
        self.assertTrue(all(c["signature_ok"] for c in self.handler.calls))
        self.assertIn("GET", [c["method"] for c in self.handler.calls])
        self.assertIn("POST", [c["method"] for c in self.handler.calls])   # 딥링크

    def test_no_fabricated_rating_or_sales(self):
        """쿠팡은 평점·판매량을 주지 않는다. 없는 값을 만들어 내면 안 된다."""
        for p in CoupangSource().fetch(Config(), 5):
            self.assertEqual(p.rating, 0.0)
            self.assertEqual(p.reviews, 0)
            self.assertEqual(p.sold, 0)
            self.assertGreater(p.rank, 0)

    def test_urls_converted_to_partner_deeplinks(self):
        for p in CoupangSource().fetch(Config(), 3):
            self.assertTrue(p.url.startswith("https://link.coupang.com/a/"), p.url)

    def test_subid_appended_to_final_link(self):
        product = CoupangSource().fetch(Config(), 1)[0]
        cfg = Config(tracker_base="https://link.example.com")
        link = build_link(product, cfg, "youtube")
        self.assertIn(f"subId={link['code']}", link["target"])
        self.assertTrue(link["target"].startswith("https://link.coupang.com/a/"))
        self.assertEqual(link["link"], f"https://link.example.com/r/{link['code']}")

    def test_script_uses_rank_instead_of_missing_rating(self):
        product = CoupangSource().fetch(Config(), 1)[0]
        script = build_script_template(product, Config(duration=30.0))
        proof = next(b for b in script.beats if b.name == "PROOF")
        self.assertIn("인기 순위", proof.narration)
        self.assertNotIn("평점", proof.narration)
        self.assertEqual(proof_badge(product, "ko"), "인기 1위")
        self.assertIn("#쿠팡", script.hashtags)
        self.assertNotIn("#해외직구", script.hashtags)   # 국내 배송 상품이다

    def test_goldbox_endpoint(self):
        os.environ["COUPANG_ENDPOINT"] = "goldbox"
        items = CoupangSource().fetch(Config(), 2)
        self.assertEqual(len(items), 2)
        self.assertTrue(any("goldbox" in c["path"] for c in self.handler.calls))

    def test_unknown_endpoint_is_rejected(self):
        os.environ["COUPANG_ENDPOINT"] = "없는엔드포인트"
        with self.assertRaises(SourceError):
            CoupangSource().fetch(Config(), 2)


class WrongCredentialTest(MockServerTestCase):
    def test_bad_secret_raises_source_error(self):
        os.environ["COUPANG_SECRET_KEY"] = "틀린비밀키"
        with self.assertRaises(SourceError) as ctx:
            CoupangSource().fetch(Config(), 3)
        self.assertIn("401", str(ctx.exception))


class DeeplinkFallbackTest(unittest.TestCase):
    """딥링크 API 가 죽어도 원본 URL 로 계속 진행해야 한다."""

    def setUp(self):
        class NoDeeplink(MockHandler):
            access_key, secret_key = ACCESS, SECRET
            calls: List[Dict] = []

            def do_POST(self):                      # noqa: N802
                self._json(500, {"rCode": "500", "rMessage": "deeplink down"})

        self.httpd, self.base, _ = start(ACCESS, SECRET)
        self.httpd.RequestHandlerClass = NoDeeplink
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        os.environ.update({"COUPANG_ACCESS_KEY": ACCESS, "COUPANG_SECRET_KEY": SECRET,
                           "COUPANG_API_HOST": self.base})

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        for k in ("COUPANG_ACCESS_KEY", "COUPANG_SECRET_KEY", "COUPANG_API_HOST"):
            os.environ.pop(k, None)

    def test_falls_back_to_original_url(self):
        self.assertEqual(deeplink(["https://www.coupang.com/vp/products/1"]), {})
        items = CoupangSource().fetch(Config(), 2)
        self.assertEqual(len(items), 2)
        for p in items:
            self.assertTrue(p.url.startswith("https://www.coupang.com/vp/products/"))


if __name__ == "__main__":
    unittest.main()
