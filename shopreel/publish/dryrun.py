# -*- coding: utf-8 -*-
"""업로드하지 않고 업로드 패키지만 만드는 기본 퍼블리셔.

output/shopreel/upload/<코드>/ 에 영상·썸네일·문구·해시태그를 모아 둔다.
수동 업로드나 예약 발행 도구(버퍼·메타 크리에이터 스튜디오)에 그대로 넣으면 된다.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Dict, Tuple

from ..config import Config
from ..models import PostResult
from .base import Publisher


class DryRunPublisher(Publisher):
    name = "dryrun"
    needs = ()

    def available(self) -> Tuple[bool, str]:
        return True, "항상 사용 가능 (업로드 패키지 생성)"

    def publish(self, video: Path, meta: Dict, cfg: Config) -> PostResult:
        code = meta.get("code") or "manual"
        folder = cfg.out_dir / "upload" / str(code)
        folder.mkdir(parents=True, exist_ok=True)
        try:
            if video and Path(video).exists():
                shutil.copy2(video, folder / Path(video).name)
            thumb = meta.get("thumbnail")
            if thumb and Path(thumb).exists():
                shutil.copy2(thumb, folder / Path(thumb).name)
            (folder / "caption.txt").write_text(
                f"{meta.get('title','')}\n\n{meta.get('description','')}\n",
                encoding="utf-8")
            (folder / "meta.json").write_text(
                json.dumps(meta, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8")
        except Exception as e:
            return self.error(f"패키지 생성 실패: {e}")
        return self.done(post_id=str(code), url=str(folder), status="dryrun",
                         message="업로드 패키지 생성")
