#!/bin/sh
# 공개하기 전에 한 번 돌려 보는 점검.
# 사람이 죽을 수도 있는 서비스라서, 전화번호부터 봅니다.
set -eu
cd "$(dirname "$0")/../.."

FAIL=0
say()  { printf '  %s\n' "$1"; }
bad()  { printf '  [확인필요] %s\n' "$1"; FAIL=1; }

echo
echo "── 하나의 길 · 공개 전 점검 ──────────────────────────────"
echo

echo "1. 테스트"
if python3 -m unittest discover -s tests -p 'test_oneway.py' >/dev/null 2>&1; then
  say "통과"
else
  bad "테스트가 실패합니다. python3 -m unittest discover -s tests 로 확인하십시오."
fi

echo
echo "2. 긴급 전화번호 (가장 중요)"
grep -o '"[0-9][0-9-]*"' oneway/counselor/safety.py | sort -u | head -8 | while read -r n; do
  say "$n"
done
bad "위 번호가 지금도 맞는지 직접 확인하십시오. 틀리면 사람이 다칩니다."

echo
echo "3. 설정"
CFG="${1:-deploy/config/config.json}"
if [ -f "$CFG" ]; then
  say "설정 파일: $CFG"
  python3 - "$CFG" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
url = cfg.get("site_url", "")
if not url or "example" in url:
    print("  [확인필요] site_url 이 아직 예시입니다:", url or "(비어 있음)")
else:
    print("  site_url:", url)
if not url.startswith("https://"):
    print("  [확인필요] site_url 이 https 가 아닙니다")
print("  요청 제한:", "켜짐" if cfg.get("rate_limit", True) else "[확인필요] 꺼짐")
print("  프록시 신뢰:", "켜짐" if cfg.get("trust_proxy") else "꺼짐 (nginx 뒤라면 켜세요)")
for k in ("naver_verify", "google_verify"):
    if not cfg.get(k):
        print(f"  {k} 가 비어 있습니다 (검색 등록 전이면 괜찮습니다)")
PY
else
  bad "설정 파일이 없습니다: $CFG  (deploy/config/config.example.json 을 복사하십시오)"
fi

echo
echo "4. 상담 엔진"
python3 -m oneway check 2>/dev/null | sed -n '4,8p' | sed 's/^/  /'

echo
echo "5. 개인정보"
if [ -d data ] && git check-ignore -q data 2>/dev/null; then
  say "data/ 가 git 에서 제외되어 있습니다"
elif [ -d data ]; then
  bad "data/ 가 git 에 올라갈 수 있습니다. .gitignore 를 확인하십시오."
else
  say "data/ 없음 (아직 시작 전)"
fi

echo
echo "6. 아직 사람이 해야 하는 일"
say "상표 검색 — 「하나의 길」 · 「ONE WAY」"
say "기부 단체 확정 (donate.py 의 DEFAULT_CAUSES)"
say "책을 팔 계획이면 기부금품법·문구 확인"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "── 자동으로 확인할 수 있는 것은 모두 통과했습니다 ──"
else
  echo "── 위 [확인필요] 항목을 처리한 뒤 공개하십시오 ──"
fi
echo
