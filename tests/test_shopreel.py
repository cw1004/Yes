# -*- coding: utf-8 -*-
"""SHOPREEL 파이프라인 단위 테스트 (렌더링 없이 빠르게 도는 것만)."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from shopreel import affiliate, compliance, revenue, scriptgen, sources
from shopreel.config import BEAT_ORDER, Config
from shopreel.models import PostResult, Product, VideoAsset
from shopreel.publish import get as get_publisher
from shopreel.rank import dedupe, passes_filter, rank, score
from shopreel.sources.custom import normalize
from shopreel.store import Store
from shopreel.tracker import serve


def sample_product(**kw) -> Product:
    data = dict(source="demo", product_id="P1", title="무선 미니 선풍기 5000mAh",
                url="https://shop.test/item/P1", price=19.0, orig_price=38.0,
                rating=4.8, reviews=1200, sold=5000, commission=12.0,
                category="생활가전", highlights=["3단 풍량", "14시간 사용"])
    data.update(kw)
    return Product(**data)


class ConfigTest(unittest.TestCase):
    def test_beats_sum_to_duration(self):
        for duration in (10.0, 15.0, 30.0, 45.0, 60.0):
            cfg = Config(duration=duration)
            secs = cfg.beat_seconds()
            self.assertEqual(sorted(secs), sorted(BEAT_ORDER))
            self.assertAlmostEqual(sum(secs.values()), duration, places=2)

    def test_affiliate_defaults_read_env(self):
        os.environ["AMAZON_ASSOC_TAG"] = "mytag-20"
        try:
            conf = Config().affiliate_for("amazon")
            self.assertEqual(conf["tag"], "mytag-20")
        finally:
            del os.environ["AMAZON_ASSOC_TAG"]


class ComplianceTest(unittest.TestCase):
    def test_banned_products_rejected(self):
        self.assertFalse(compliance.is_allowed("명품 레플리카 가방"))
        self.assertFalse(compliance.is_allowed("전자담배 액상 세트"))
        self.assertTrue(compliance.is_allowed("무선 미니 선풍기"))

    def test_scrub_softens_claims(self):
        self.assertNotIn("최저가 보장", compliance.scrub("업계 최저가 보장 상품"))
        self.assertNotIn("guaranteed", compliance.scrub("results guaranteed").lower())

    def test_disclosure_prepended_once(self):
        body = compliance.caption_with_disclosure("본문", "ko")
        self.assertTrue(body.startswith("이 영상은 제휴 링크"))
        self.assertEqual(body, compliance.caption_with_disclosure(body, "ko"))

    def test_disclosure_not_skipped_by_common_characters(self):
        # '이', '#광고' 같은 조각이 우연히 들어 있어도 표기는 반드시 붙어야 한다
        for body in ("코시 접이식 LED 스탠드", "이 제품은 인기 상품", "광고 문구가 아닌 본문"):
            out = compliance.caption_with_disclosure(body, "ko")
            self.assertTrue(out.startswith("이 영상은 제휴 링크"), body)
        self.assertTrue(compliance.has_disclosure(
            compliance.caption_with_disclosure("본문", "ko"), "ko"))

    def test_trailing_ad_hashtag_does_not_count_as_disclosure(self):
        # 본문 끝 해시태그는 '더보기'에 가려지므로 앞선 표기로 인정하지 않는다
        body = "상품 설명\n가격: 23,900원\n\n#광고 #꿀템"
        self.assertFalse(compliance.has_disclosure(body, "ko"))
        self.assertTrue(compliance.caption_with_disclosure(body, "ko")
                        .startswith("이 영상은 제휴 링크"))

    def test_ad_tags_forced_to_front(self):
        tags = compliance.ensure_tags(["#꿀템"], "ko")
        self.assertEqual(tags[0], "#광고")


class RankTest(unittest.TestCase):
    def test_filter_uses_config_bounds(self):
        cfg = Config(min_rating=4.5, min_reviews=100, max_price=50.0)
        self.assertTrue(passes_filter(sample_product(), cfg))
        self.assertFalse(passes_filter(sample_product(rating=3.9), cfg))
        self.assertFalse(passes_filter(sample_product(price=500.0), cfg))

    def test_velocity_beats_volume(self):
        rising = sample_product(product_id="A", sold=5000, sold_delta=900)
        flat = sample_product(product_id="B", sold=9000, sold_delta=0)
        self.assertGreater(score(rising), score(flat))

    def test_dedupe_keeps_best_of_similar_titles(self):
        a = sample_product(product_id="A", title="무선 미니 선풍기 5000mAh 목걸이형")
        b = sample_product(product_id="B", title="무선 미니 선풍기 5000mAh 목걸이용")
        a.score, b.score = 90.0, 40.0
        kept = dedupe([a, b])
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0].product_id, "A")

    def test_rank_excludes_recently_made(self):
        cfg = Config(min_reviews=0, min_rating=0)
        p = sample_product()
        self.assertEqual(rank([p], cfg, exclude={p.key: 0.0}), [])


class AffiliateTest(unittest.TestCase):
    def test_amazon_tag_and_subid(self):
        cfg = Config(affiliate={"amazon": {"tag": "mytag-20"}}, tracker_base="https://t.example")
        p = sample_product(source="amazon", url="https://www.amazon.com/dp/B01")
        link = affiliate.build_link(p, cfg, "youtube")
        self.assertIn("tag=mytag-20", link["target"])
        self.assertIn(f"ascsubtag={link['code']}", link["target"])
        self.assertIn("utm_medium=youtube", link["target"])
        self.assertEqual(link["link"], f"https://t.example/r/{link['code']}")

    def test_missing_tag_falls_back_to_original_url(self):
        cfg = Config(tracker_base="")
        p = sample_product(source="aliexpress")
        link = affiliate.build_link(p, cfg, "tiktok")
        self.assertTrue(link["target"].startswith("https://shop.test/item/P1"))
        self.assertEqual(link["link"], link["target"])   # 추적 서버가 없으면 제휴 링크 그대로

    def test_platform_codes_differ(self):
        cfg = Config()
        p = sample_product()
        self.assertNotEqual(affiliate.build_link(p, cfg, "youtube")["code"],
                            affiliate.build_link(p, cfg, "tiktok")["code"])


class ScriptTest(unittest.TestCase):
    def test_template_script_structure(self):
        cfg = Config(duration=30.0)
        script = scriptgen.build_script_template(sample_product(), cfg)
        self.assertEqual([b.name for b in script.beats], BEAT_ORDER)
        self.assertAlmostEqual(script.seconds, 30.0, places=1)
        for beat in script.beats:
            limit = scriptgen.max_chars(beat.seconds, "ko")
            self.assertLessEqual(len(beat.narration), limit)
            self.assertTrue(beat.narration)
        self.assertIn("#광고", script.hashtags)

    def test_description_starts_with_disclosure_and_link(self):
        cfg = Config()
        body = scriptgen.build_description(sample_product(), cfg, "https://t.example/r/abc")
        self.assertTrue(body.startswith("이 영상은 제휴 링크"))
        self.assertIn("https://t.example/r/abc", body)
        self.assertIn("#광고", body)

    def test_description_keeps_disclosure_for_any_product_title(self):
        cfg = Config()
        for title in ("코시 접이식 LED 스탠드", "이 상품", "광고판 조명"):
            body = scriptgen.build_description(sample_product(title=title), cfg, "")
            self.assertTrue(body.startswith("이 영상은 제휴 링크"), title)

    def test_english_script(self):
        cfg = Config(lang="en", duration=15.0)
        script = scriptgen.build_script_template(sample_product(), cfg)
        self.assertIn("#ad", script.hashtags)
        self.assertAlmostEqual(script.seconds, 15.0, places=1)


class SourceTest(unittest.TestCase):
    def test_demo_source_always_available(self):
        src = sources.get("demo")
        ok, _ = src.available()
        self.assertTrue(ok)
        items = src.fetch(Config(), 5)
        self.assertEqual(len(items), 5)
        self.assertTrue(all(i.url and i.title for i in items))

    def test_api_sources_report_missing_keys(self):
        for name in ("aliexpress", "amazon", "coupang", "rakuten", "ebay"):
            ok, why = sources.get(name).available()
            if not ok:
                self.assertIn("환경변수", why)

    def test_custom_source_field_aliases(self):
        p = normalize({"itemId": "9", "name": "테스트 상품",
                       "link": "https://www.amazon.com/dp/X", "sale_price": "12.50",
                       "ratings_total": "310", "evaluate_rate": 4.6})
        self.assertEqual(p.product_id, "9")
        self.assertEqual(p.price, 12.5)
        self.assertEqual(p.reviews, 310)
        self.assertEqual(p.source, "amazon")     # URL 로 네트워크 추정


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "test.db")

    def tearDown(self):
        self.tmp.cleanup()

    def test_sold_delta_from_previous_snapshot(self):
        p = sample_product(sold=1000)
        self.assertEqual(self.store.upsert_product(p), 0)
        again = sample_product(sold=1250)
        self.assertEqual(self.store.upsert_product(again), 250)

    def test_video_post_and_daily_limit(self):
        p = sample_product()
        self.store.upsert_product(p)
        vid = self.store.add_video(VideoAsset(product_key=p.key, path="a.mp4", seconds=30))
        self.store.add_post(vid, p.key, PostResult(platform="youtube", ok=True,
                                                   status="published", post_id="x"))
        self.assertEqual(self.store.posted_today("youtube"), 1)
        self.assertEqual(self.store.posted_today("tiktok"), 0)
        self.assertIn(p.key, self.store.recently_made(30))

    def test_conversion_is_idempotent(self):
        self.assertTrue(self.store.add_conversion("c1", "ORD1", 10.0, 1.5))
        self.assertFalse(self.store.add_conversion("c1", "ORD1", 10.0, 1.5))

    def test_epc_feedback_needs_enough_clicks(self):
        p = sample_product()
        self.store.upsert_product(p)
        self.store.add_link("c1", p.key, "youtube", "https://x.test")
        for _ in range(6):
            self.store.add_click("c1")
        self.store.add_conversion("c1", "ORD2", 30.0, 6.0)
        self.assertGreater(self.store.category_performance().get("생활가전", 0), 0)


class RevenueTest(unittest.TestCase):
    def test_csv_import_with_varied_headers(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        store = Store(Path(tmp.name) / "r.db")
        csv_path = Path(tmp.name) / "report.csv"
        csv_path.write_text(
            "Order ID,SubId,Sale Amount,Commission,Currency,Date\n"
            "A-1,code123,25.00,3.75,USD,2026-01-05\n"
            "A-2,code123,10.00,1.20,USD,2026-01-06\n",
            encoding="utf-8")
        stats = revenue.import_csv(csv_path, store, network="amazon")
        self.assertEqual(stats["added"], 2)
        report = revenue.report(store, days=36500)
        self.assertEqual(report["summary"]["orders"], 2)
        self.assertAlmostEqual(report["summary"]["revenue"], 4.95, places=2)
        self.assertIn("최근", revenue.format_report(report))


class PublishTest(unittest.TestCase):
    def test_dryrun_creates_upload_package(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cfg = Config(out_dir=Path(tmp.name))
        video = Path(tmp.name) / "v.mp4"
        video.write_bytes(b"fake")
        result = get_publisher("dryrun").publish(
            video, {"code": "abc", "title": "제목", "description": "본문", "hashtags": []}, cfg)
        self.assertTrue(result.ok)
        folder = Path(tmp.name) / "upload" / "abc"
        self.assertTrue((folder / "caption.txt").exists())
        self.assertTrue((folder / "meta.json").exists())
        self.assertTrue((folder / "v.mp4").exists())

    def test_publishers_without_credentials_are_skipped_not_crashed(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cfg = Config(out_dir=Path(tmp.name))
        video = Path(tmp.name) / "v.mp4"
        video.write_bytes(b"fake")
        for name in ("youtube", "tiktok", "facebook"):
            pub = get_publisher(name)
            if not pub.available()[0]:
                r = pub.publish(video, {"title": "t", "description": "d"}, cfg)
                self.assertEqual(r.status, "skipped")


class TrackerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = Config(out_dir=Path(self.tmp.name))
        self.store = Store(self.cfg.db)
        self.store.add_link("abc123", "pk", "youtube", "https://shop.test/item/1")
        self.httpd, _ = serve(self.cfg, host="127.0.0.1", port=0, store=self.store)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def _open_no_redirect(self, url):
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **kw):
                return None
        return urllib.request.build_opener(NoRedirect).open(url)

    def test_redirect_records_click(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._open_no_redirect(f"{self.base}/r/abc123")
        self.assertEqual(ctx.exception.code, 302)
        self.assertEqual(ctx.exception.headers["Location"], "https://shop.test/item/1")
        self.assertEqual(self.store.summary(1)["clicks"], 1)

    def test_unknown_code_is_404(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._open_no_redirect(f"{self.base}/r/nope")
        self.assertEqual(ctx.exception.code, 404)

    def test_postback_records_conversion(self):
        body = json.dumps({"code": "abc123", "order_id": "O-1", "amount": 20.0,
                           "commission": 3.0}).encode()
        req = urllib.request.Request(f"{self.base}/postback", data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        payload = json.loads(urllib.request.urlopen(req).read().decode())
        self.assertTrue(payload["ok"])
        self.assertEqual(self.store.summary(1)["orders"], 1)


class DeploymentTest(unittest.TestCase):
    """배포 산출물이 코드와 어긋나지 않는지 확인한다."""

    root = Path(__file__).resolve().parent.parent

    def test_config_template_loads(self):
        raw = (self.root / "deploy" / "shopreel.config.template.json").read_text(
            encoding="utf-8").replace("__DOMAIN__", "link.example.com")
        cfg = Config.from_dict(json.loads(raw))
        self.assertEqual(cfg.tracker_base, "https://link.example.com")
        self.assertEqual(cfg.out_dir, Path("/var/lib/shopreel"))
        self.assertEqual(cfg.extra, {})           # 오타·폐기된 항목이 없어야 한다
        self.assertLessEqual(cfg.daily_limit["youtube"], 6)

    def test_env_template_is_systemd_compatible(self):
        """systemd EnvironmentFile 은 export 접두사를 지원하지 않는다."""
        lines = (self.root / "deploy" / "shopreel.env.template").read_text(
            encoding="utf-8").splitlines()
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            self.assertNotIn("export ", stripped, line)
            self.assertIn("=", line, line)

    def test_systemd_units_point_at_the_real_cli(self):
        unit = (self.root / "deploy" / "systemd" / "shopreel-tracker.service").read_text(
            encoding="utf-8")
        self.assertIn("-m shopreel serve", unit)
        self.assertIn("ReadWritePaths=/var/lib/shopreel", unit)
        run = (self.root / "deploy" / "systemd" / "shopreel-run.service").read_text(
            encoding="utf-8")
        self.assertIn("-m shopreel run", run)
        backup = (self.root / "deploy" / "systemd" / "shopreel-backup.service").read_text(
            encoding="utf-8")
        self.assertIn("-m shopreel prune", backup)

    def test_install_script_replacements_match_the_units(self):
        """install.sh 가 치환하는 문자열이 실제 유닛에 존재해야 한다."""
        units = "".join((self.root / "deploy" / "systemd" / name).read_text(encoding="utf-8")
                        for name in ("shopreel-tracker.service", "shopreel-run.service",
                                     "shopreel-backup.service"))
        for needle in ("/opt/shopreel", "--port 8787", "User=shopreel"):
            self.assertIn(needle, units, needle)


class ReadinessTest(unittest.TestCase):
    def warnings(self, **kw) -> str:
        from shopreel.cli import readiness_warnings
        return " / ".join(readiness_warnings(Config(**kw)))

    def test_instagram_needs_public_https(self):
        text = self.warnings(publish_to=["instagram"], tracker_base="http://localhost:8787")
        self.assertIn("공개 영상 URL", text)
        clean = self.warnings(publish_to=["instagram"],
                              tracker_base="https://link.example.com")
        self.assertNotIn("공개 영상 URL", clean)

    def test_http_tracker_is_flagged(self):
        self.assertIn("https", self.warnings(publish_to=["youtube"],
                                             tracker_base="http://link.example.com"))

    def test_youtube_quota_limit_is_flagged(self):
        text = self.warnings(publish_to=["youtube"], tracker_base="https://x.example.com",
                             daily_limit={"youtube": 20})
        self.assertIn("하루 6건", text)

    def test_dryrun_only_setup_is_quiet_about_tracker(self):
        text = self.warnings(publish_to=["dryrun"], tracker_base="http://localhost:8787")
        self.assertNotIn("링크인바이오", text)


class ServeShutdownTest(unittest.TestCase):
    """systemd 는 정지·재시작 때 SIGTERM 을 보낸다 — 깨끗이 끝나야 한다."""

    def test_sigterm_exits_cleanly(self):
        import signal
        import subprocess
        import urllib.request

        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        proc = subprocess.Popen(
            [sys.executable, "-m", "shopreel", "serve", "--host", "127.0.0.1",
             "--port", "8873", "--out", tmp.name],
            cwd=str(Path(__file__).resolve().parent.parent),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.addCleanup(proc.kill)
        for _ in range(50):
            try:
                urllib.request.urlopen("http://127.0.0.1:8873/health", timeout=1).read()
                break
            except Exception:
                time.sleep(0.2)
        else:
            self.fail("서버가 뜨지 않았습니다")

        proc.send_signal(signal.SIGTERM)
        self.assertEqual(proc.wait(timeout=15), 0)
        self.assertIn("종료", proc.stdout.read())


class PipelineDryRunTest(unittest.TestCase):
    def test_run_once_dry_run_makes_no_video_but_records_plan(self):
        from shopreel.pipeline import run_once
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cfg = Config(out_dir=Path(tmp.name), sources=["demo"], publish_to=["dryrun"],
                     top_n=2, dry_run=True, duration=15.0)
        result = run_once(cfg, log=lambda *_: None)
        self.assertEqual(len(result.videos), 2)
        self.assertEqual(result.errors, [])
        self.assertFalse(any(Path(v.path).exists() for v in result.videos))
        self.assertTrue(list((Path(tmp.name) / "report").glob("run_*.json")))
        self.assertTrue(list((Path(tmp.name) / "script").glob("*.json")))


if __name__ == "__main__":
    unittest.main()
