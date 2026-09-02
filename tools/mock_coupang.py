# -*- coding: utf-8 -*-
"""쿠팡 파트너스 오픈 API 목(mock) 서버.

실제 파트너스 키가 없어도 파이프라인 전체를 검증하기 위한 로컬 서버다.
**요청의 CEA HMAC 서명을 실제로 재계산해 검증**하므로, 여기서 통과하면
서명·경로·쿼리 조합이 실서버에서도 그대로 통한다.

  python3 -m tools.mock_coupang            # 단독 실행 (기본 8790 포트)
  COUPANG_API_HOST=http://127.0.0.1:8790 python3 -m shopreel run --sources coupang

지원 엔드포인트
  GET  /v2/.../v1/products/bestcategories/{cat}?limit=N
  GET  /v2/.../v1/products/goldbox?limit=N
  POST /v2/.../v1/deeplink
  GET  /img/{id}.jpg           상품 사진(테스트용으로 생성)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, List, Optional, Tuple
from urllib.parse import unquote, urlparse

BASE = "/v2/providers/affiliate_open_api/apis/openapi/v1"

# 쿠팡 응답 형식을 그대로 흉내 낸 표본 (평점·판매량 필드는 실제로도 없다)
FIXTURES: List[Dict] = [
    {"rank": 1, "productId": 7539201234, "productName": "샤오미 미지아 무선 전동 공기청정기 3H 필터포함",
     "productPrice": 129000, "basePrice": 189000, "discountRate": 31,
     "categoryName": "가전디지털", "isRocket": True, "isFreeShipping": True},
    {"rank": 2, "productId": 7539205678, "productName": "삼성전자 무선 블루투스 이어폰 노이즈캔슬링 케이스포함",
     "productPrice": 89000, "basePrice": 139000, "discountRate": 36,
     "categoryName": "가전디지털", "isRocket": True, "isFreeShipping": True},
    {"rank": 3, "productId": 7539209012, "productName": "코시 접이식 LED 스탠드 무단조절 USB 충전식",
     "productPrice": 23900, "basePrice": 39900, "discountRate": 40,
     "categoryName": "가전디지털", "isRocket": True, "isFreeShipping": False},
    {"rank": 4, "productId": 7539203456, "productName": "브라운 미니 전기면도기 방수 휴대용 USB 충전",
     "productPrice": 45900, "basePrice": 69000, "discountRate": 33,
     "categoryName": "가전디지털", "isRocket": False, "isFreeShipping": True},
    {"rank": 5, "productId": 7539207890, "productName": "디클 고속 무선충전 거치대 15W 각도조절 스탠드형",
     "productPrice": 19800, "basePrice": 32000, "discountRate": 38,
     "categoryName": "가전디지털", "isRocket": True, "isFreeShipping": True},
]


def product_photo(seed: int, size: Tuple[int, int] = (900, 900)) -> bytes:
    """테스트용 상품 사진(흰 배경 + 단순 오브젝트)을 만들어 바이트로 돌려준다."""
    import io
    import random

    from PIL import Image, ImageDraw, ImageFilter

    rng = random.Random(seed)
    w, h = size
    img = Image.new("RGB", (w, h), (247, 247, 245))
    d = ImageDraw.Draw(img)
    hue = [(38, 60, 92), (46, 46, 50), (176, 58, 46), (32, 92, 84), (92, 62, 120)][seed % 5]
    cx, cy = w // 2, int(h * 0.52)
    body_w, body_h = int(w * 0.42), int(h * 0.46)

    shadow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(shadow).ellipse(
        [cx - body_w * 0.6, cy + body_h * 0.38, cx + body_w * 0.6, cy + body_h * 0.62], fill=110)
    img.paste((214, 214, 210), (0, 0), shadow.filter(ImageFilter.GaussianBlur(24)))

    d.rounded_rectangle([cx - body_w // 2, cy - body_h // 2, cx + body_w // 2, cy + body_h // 2],
                        radius=int(body_w * 0.18), fill=hue)
    d.rounded_rectangle([cx - body_w // 2 + 18, cy - body_h // 2 + 18,
                         cx - body_w // 2 + 46, cy + body_h // 2 - 18],
                        radius=14, fill=tuple(min(255, c + 42) for c in hue))
    for i in range(3):
        r = int(body_w * (0.18 - i * 0.05))
        d.ellipse([cx - r, cy - r + int(body_h * 0.06), cx + r, cy + r + int(body_h * 0.06)],
                  outline=(250, 250, 250), width=max(2, 6 - i * 2))
    if rng.random() > 0.5:
        d.rounded_rectangle([cx - body_w // 3, cy + body_h // 2 + 14,
                             cx + body_w // 3, cy + body_h // 2 + 40],
                            radius=12, fill=(205, 205, 205))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def verify_signature(auth_header: str, method: str, path: str, query: str,
                     access: str, secret: str) -> Tuple[bool, str]:
    """쿠팡이 서버에서 하는 검증을 그대로 재현한다."""
    if not auth_header:
        return False, "Authorization 헤더 없음"
    m = re.match(r"CEA algorithm=HmacSHA256, access-key=([^,]+), "
                 r"signed-date=([^,]+), signature=([0-9a-f]+)", auth_header.strip())
    if not m:
        return False, f"헤더 형식 불일치: {auth_header[:80]}"
    got_access, signed_date, signature = m.groups()
    if got_access != access:
        return False, "access-key 불일치"
    message = f"{signed_date}{method}{path}{query}"
    expected = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return False, "signature 불일치"
    return True, "ok"


class MockHandler(BaseHTTPRequestHandler):
    access_key = "test-access"
    secret_key = "test-secret"
    fixtures: List[Dict] = FIXTURES
    calls: List[Dict] = []
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        pass

    # -------------------------------------------------------------- 도우미
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: Dict) -> None:
        self._send(code, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                   "application/json;charset=UTF-8")

    def _check(self, method: str, path: str, query: str) -> bool:
        ok, why = verify_signature(self.headers.get("Authorization", ""), method, path, query,
                                   self.access_key, self.secret_key)
        type(self).calls.append({"method": method, "path": path, "query": query,
                                 "signature_ok": ok, "reason": why})
        if not ok:
            self._json(401, {"rCode": "401", "rMessage": f"인증 실패: {why}"})
        return ok

    def _base_url(self) -> str:
        return f"http://{self.headers.get('Host', 'localhost')}"

    def _items(self, limit: int) -> List[Dict]:
        rows = []
        for item in self.fixtures[:limit]:
            row = dict(item)
            pid = row["productId"]
            row["productImage"] = f"{self._base_url()}/img/{pid}.jpg"
            row["productUrl"] = f"https://www.coupang.com/vp/products/{pid}"
            rows.append(row)
        return rows

    # -------------------------------------------------------------- 라우팅
    def do_GET(self) -> None:            # noqa: N802
        parsed = urlparse(self.path)
        path, query = parsed.path, parsed.query

        if path.startswith("/img/"):
            seed = int(re.sub(r"\D", "", path) or 0) % 1000
            return self._send(200, product_photo(seed), "image/jpeg")

        if path.startswith(f"{BASE}/products/bestcategories/") or \
           path == f"{BASE}/products/goldbox" or path == f"{BASE}/products/search":
            if not self._check("GET", path, query):
                return
            limit = 10
            for part in query.split("&"):
                if part.startswith("limit="):
                    limit = int(part[6:] or 10)
            return self._json(200, {"rCode": "0", "rMessage": "",
                                    "data": self._items(limit)})

        self._json(404, {"rCode": "404", "rMessage": "not found"})

    def do_POST(self) -> None:           # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != f"{BASE}/deeplink":
            return self._json(404, {"rCode": "404", "rMessage": "not found"})
        if not self._check("POST", parsed.path, parsed.query):
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        urls = body.get("coupangUrls") or []
        sub_id = body.get("subId", "")
        data = []
        for url in urls:
            pid = re.sub(r"\D", "", url)[-6:] or "000000"
            short = f"https://link.coupang.com/a/{pid}"
            data.append({"originalUrl": url, "shortenUrl": short,
                         "landingUrl": f"{short}?subId={sub_id}" if sub_id else short})
        self._json(200, {"rCode": "0", "rMessage": "", "data": data})


def start(access: str = "test-access", secret: str = "test-secret",
          port: int = 0, fixtures: Optional[List[Dict]] = None
          ) -> Tuple[ThreadingHTTPServer, str, type]:
    """(서버, 베이스 URL, 핸들러 클래스) 를 돌려준다. 호출측이 serve_forever 를 돌린다."""
    handler = type("BoundMockHandler", (MockHandler,), {
        "access_key": access, "secret_key": secret,
        "fixtures": list(fixtures or FIXTURES), "calls": [],
    })
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}", handler


def main() -> int:
    import os
    port = int(os.environ.get("PORT", "8790"))
    httpd, base, _ = start(os.environ.get("COUPANG_ACCESS_KEY", "test-access"),
                           os.environ.get("COUPANG_SECRET_KEY", "test-secret"), port)
    print(f"쿠팡 목 서버 시작: {base}")
    print(f"  COUPANG_API_HOST={base} python3 -m shopreel run --sources coupang")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
