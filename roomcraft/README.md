# ROOMCRAFT Auto Factory V3

상품 링크 하나를 붙여넣으면 제품 정보 · 스크립트 · 9:16 영상 · SNS 캡션까지 한 줄로 이어지는
워크플로 데모입니다. IMPORT → STUDIO → PUBLISH 세 단계로 구성돼 있고, 백엔드 없이 브라우저에서
바로 동작합니다.

## 실행

빌드된 결과물을 브라우저에서 열기만 하면 됩니다.

```
dist/Roomcraft-Auto-Factory-V3.html
```

React·Tailwind·제품 이미지가 모두 파일 안에 들어 있어 인터넷 없이도 열립니다.

## 빌드

```bash
npm install
npm run build     # dist/ 에 두 개의 HTML 생성
npm run smoke     # 전체 플로우 자동 확인 (npm i --no-save playwright 필요)
npm run assets    # assets/source/*.png → assets/*.webp 재생성
```

| 출력 | 크기 | 용도 |
| --- | --- | --- |
| `Roomcraft-Auto-Factory-V3.html` | ~412 KB | 완전 독립 실행. 오프라인에서도 열림 |
| `Roomcraft-Auto-Factory-V3.cdn.html` | ~273 KB | React를 cdnjs에서 로드. 온라인 배포용 |

## 구조

```
src/App.tsx            앱 전체 (단일 컴포넌트)
src/index.css          Tailwind 진입점 + 폰트·모션 설정
src/shims/             cdnjs UMD 전역을 import 로 쓰기 위한 어댑터
build.mjs              esbuild + Tailwind → 단일 HTML
tools/prepare_assets.py  원본 PNG → 웹용 WebP
tools/smoke.mjs        Playwright 전체 플로우 검증
assets/*.webp          앱에 인라인되는 제품 컷아웃 5종
assets/source/*.png    원본 투명 배경 PNG (1600~1920px)
```

## V3에서 실제로 고친 것

이전 배포본의 `README.txt`에 수정 완료로 적혀 있었지만 코드에는 반영되지 않았던 항목들입니다.

| 항목 | 이전 상태 | 현재 |
| --- | --- | --- |
| 구매 링크 | `handleOpenBuyLink`가 정의만 되고 호출되는 곳이 없었음 | 프리뷰의 `구매하기`와 제품 카드의 `구매 페이지 열기`가 원본 링크를 새 탭으로 엶 |
| `구매하기` 요소 | 클릭 불가능한 `<div>` | 실제 `<button>` |
| 큐 테이블 | 행에 핸들러 없음 | 행 클릭·Enter로 상세 모달 (채널·조회수·상태) |
| 룸 프리뷰 | 기능 자체가 없었음 | 제품 컷아웃 5종을 배치한 룸 씬 + 전체 화면 모달 |
| 가격·제목 편집 | 미리보기에만 반영, 스크립트·캡션·할인율은 그대로 | 편집 즉시 스크립트·캡션·할인율에 반영. 직접 고친 텍스트는 덮어쓰지 않음 |
| 할인율 | `34%` 하드코딩 | 판매가 ÷ 정가로 계산 |
| 예시 버튼 | 1초마다 도는 `setInterval`, 직접 DOM 조작, `#validator-marker` 노란 디버그 박스, `onPointerDown`+`onClick` 중복 실행 | React state 하나와 토스트 |
| 헤더 표기 | `AUTO FACTORY — V2`, `Build v2.0` | V3 |

그 외: 제품 이미지가 색상 블록 대신 실제 컷아웃 사진, Esc로 모달 닫기, 키보드 포커스 표시,
`prefers-reduced-motion` 대응, 언마운트 시 모든 타이머 정리.

## 데모 범위

분석·렌더링·발행은 시뮬레이션입니다. 실제 서비스로 옮길 때 바꿀 지점은 두 곳입니다.

- `makeAffiliate()` — 지금은 원본 URL을 그대로 돌려줍니다. 쿠팡 파트너스 / 아마존 어소시에이트
  변환 링크로 교체하세요.
- `handleAnalyze()` / `handleGenerate()` — 각각 크롤링·분석 API와 렌더링 잡으로 교체하세요.
