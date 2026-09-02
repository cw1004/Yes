# -*- coding: utf-8 -*-
"""수집 → 선별 → 대본 → 영상 → 업로드 → 기록까지 한 번에.

    수집(소셜커머스 API)
      → 필터·점수·중복 제거 (수익 데이터 피드백 반영)
      → 제휴 링크 + 추적 코드 발급 (플랫폼별)
      → 대본 (템플릿 또는 Claude)
      → 영상 렌더링 (제품 카드 + 내레이션 + 자막 + 광고 표기)
      → SNS 업로드 (일일 한도 준수)
      → SQLite 기록 + 리포트 파일
"""

from __future__ import annotations

import json
import shutil
import time
import traceback
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from . import affiliate, publish, revenue, scriptgen, sources
from .config import Config
from .models import PostResult, Product, RunResult, Script, VideoAsset
from .rank import rank
from .render import video as vrender
from .store import Store

Log = Callable[[str], None]


# ------------------------------------------------------------------ 1) 수집·선별
def collect_and_rank(cfg: Config, store: Store, log: Log = print) -> List[Product]:
    errors: List[str] = []
    products = sources.collect(cfg, on_error=lambda n, e: errors.append(f"{n}: {e}"))
    for err in errors:
        log(f"  ! 소스 실패 — {err}")
    log(f"  수집 {len(products)}개 (소스 {', '.join(cfg.sources)})")

    for p in products:                       # 판매량 증가분(sold_delta) 계산 + 저장
        store.upsert_product(p)

    epc = store.category_performance()
    exclude = store.recently_made(cfg.repost_after_days)
    ranked = rank(products, cfg, epc=epc, exclude=exclude)
    log(f"  후보 {len(ranked)}개 (필터·중복·최근제작 제외 후)")
    return ranked


# ------------------------------------------------------------------ 2) 한 편 제작
def make_video(product: Product, cfg: Config, store: Store,
               log: Log = print) -> Tuple[VideoAsset, Script]:
    cfg.ensure_dirs()
    script: Script = scriptgen.build_script(product, cfg)

    script_path = cfg.script_dir / f"{product.key}.json"
    script_path.write_text(json.dumps(
        {"product": product.to_dict(), "script": script.to_dict()},
        ensure_ascii=False, indent=2), encoding="utf-8")

    primary = cfg.publish_to[0] if cfg.publish_to else "dryrun"
    link = affiliate.build_link(product, cfg, primary, store)
    log(f"  대본 {script.provider} · {script.seconds:.0f}초 · 링크 {link['code']}")

    out_path = cfg.video_dir / f"{product.key}.mp4"
    if cfg.dry_run:
        return VideoAsset(product_key=product.key, path=str(out_path), seconds=script.seconds,
                          link=link["link"], target=link["target"], tts="dry-run"), script

    if out_path.exists() and not cfg.overwrite:
        log("  기존 영상 재사용")
        return VideoAsset(product_key=product.key, path=str(out_path),
                          thumbnail=str(cfg.video_dir / f"{product.key}.jpg"),
                          seconds=script.seconds, link=link["link"],
                          target=link["target"], tts="skip"), script

    workdir = cfg.work_dir / product.key
    if workdir.exists():
        shutil.rmtree(workdir, ignore_errors=True)
    path, engine, seconds = vrender.render(product, script, cfg, out_path, workdir, on_log=log)
    thumb = vrender.thumbnail(path, cfg.video_dir / f"{product.key}.jpg",
                              at=min(2.5, seconds / 4))
    if not cfg.keep_workdir:
        shutil.rmtree(workdir, ignore_errors=True)

    return (VideoAsset(product_key=product.key, path=str(path),
                       thumbnail=str(thumb) if thumb else "", seconds=seconds,
                       link=link["link"], target=link["target"], tts=engine), script)


# ------------------------------------------------------------------ 3) 업로드
def publish_video(product: Product, script: Script, asset: VideoAsset, cfg: Config,
                  store: Store, video_row_id: int, log: Log = print) -> List[PostResult]:
    results: List[PostResult] = []
    for platform in cfg.publish_to:
        try:
            pub = publish.get(platform)
        except KeyError as e:
            results.append(PostResult(platform=platform, ok=False, status="error",
                                      message=str(e)))
            continue

        limit = cfg.daily_limit.get(platform, 99)
        if store.posted_today(platform) >= limit:
            r = PostResult(platform=platform, ok=False, status="skipped",
                           message=f"일일 한도 {limit}건 도달")
            results.append(r)
            if not cfg.dry_run:
                store.add_post(video_row_id, product.key, r)
            log(f"  [{platform}] 건너뜀 — {r.message}")
            continue

        link = affiliate.build_link(product, cfg, platform, store)
        meta = {
            "code": link["code"],
            "title": script.title,
            "description": scriptgen.build_description(product, cfg, link["link"]),
            "hashtags": script.hashtags,
            "thumbnail": asset.thumbnail,
            "link": link["link"],
            "target": link["target"],
            "product": product.to_dict(),
            "seconds": asset.seconds,
        }
        if cfg.dry_run and platform != "dryrun":
            r = PostResult(platform=platform, ok=True, status="queued",
                           message="dry-run — 업로드 생략")
        else:
            r = pub.publish(Path(asset.path), meta, cfg)
        results.append(r)
        if not cfg.dry_run:
            store.add_post(video_row_id, product.key, r, payload=meta)
        icon = "✓" if r.ok else "✗"
        log(f"  [{platform}] {icon} {r.status} {r.url or r.message}")
    return results


# ------------------------------------------------------------------ 4) 1회 실행
def run_once(cfg: Config, store: Optional[Store] = None, log: Log = print) -> RunResult:
    started = time.time()
    cfg.ensure_dirs()
    store = store or Store(cfg.db)
    result = RunResult(started_at=started)

    log("[1/4] 인기 상품 수집")
    try:
        candidates = collect_and_rank(cfg, store, log)
    except Exception as e:
        result.errors.append(f"수집 실패: {e}")
        result.elapsed = time.time() - started
        return result
    result.collected = len(candidates)
    result.candidates = min(len(candidates), cfg.top_n)

    picks = candidates[:cfg.top_n]
    if not picks:
        log("  조건에 맞는 상품이 없습니다.")
        result.elapsed = time.time() - started
        return result

    for i, product in enumerate(picks, 1):
        log(f"[2/4] ({i}/{len(picks)}) 영상 제작 — {product.title[:40]} "
            f"(점수 {product.score})")
        try:
            asset, script = make_video(product, cfg, store, log)
            # dry-run 은 기록을 남기지 않는다 (재제작 금지 기간이 오염되지 않도록)
            row_id = 0 if cfg.dry_run else store.add_video(asset)
            result.videos.append(asset)
            log(f"[3/4] 업로드 — {Path(asset.path).name}")
            result.posts.extend(
                publish_video(product, script, asset, cfg, store, row_id, log))
        except Exception as e:
            msg = f"{product.title[:30]}: {type(e).__name__}: {e}"
            result.errors.append(msg)
            log(f"  ! 실패 — {msg}")
            if cfg.extra.get("debug"):
                log(traceback.format_exc(limit=3))

    log("[4/4] 리포트 저장")
    result.elapsed = time.time() - started
    write_report(result, cfg)
    return result


def write_report(result: RunResult, cfg: Config) -> Path:
    stamp = time.strftime("%Y%m%d_%H%M%S", time.localtime(result.started_at))
    path = cfg.report_dir / f"run_{stamp}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"config": cfg.to_dict(), **result.to_dict()},
                               ensure_ascii=False, indent=2, default=str),
                    encoding="utf-8")
    return path


# ------------------------------------------------------------------ 5) 재시도
def retry_pending(cfg: Config, store: Optional[Store] = None, log: Log = print) -> int:
    """queued/error 상태의 업로드를 다시 시도한다."""
    store = store or Store(cfg.db)
    rows = store.pending_posts()
    done = 0
    for row in rows:
        platform = row["platform"]
        video_path = row["video_path"]
        if not video_path or not Path(video_path).exists():
            continue
        try:
            pub = publish.get(platform)
        except KeyError:
            continue
        ok, why = pub.available()
        if not ok:
            log(f"  [{platform}] 건너뜀 — {why}")
            continue
        meta = json.loads(row["payload"] or "{}")
        r = pub.publish(Path(video_path), meta, cfg)
        store.update_post(int(row["id"]), r)
        done += 1 if r.ok else 0
        log(f"  [{platform}] {'✓' if r.ok else '✗'} {r.status} {r.url or r.message}")
    return done
