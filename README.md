# 이 저장소에 들어 있는 것

| 프로젝트 | 설명 | 문서 |
|---|---|---|
| **INDIA 2030** | 60초 숏폼 영상 100편 자동 생성 파이프라인 | 아래 |
| **⚡ scalper** | 3분할 실시간 단타 트래커 + 뉴스·거시 분석 자동매매 | [scalper/README.md](scalper/README.md) |

```bash
python3 -m scalper run          # 단타 대시보드 (키 없이 바로 실행)
python3 -m scalper scan         # 오늘의 추천 3선
python3 -m scalper macro        # 세계 정세·거시 레짐 판독
```

---

# INDIA 2030 — 60초 영상 100편 자동 생성기

한 소년과 낡은 축구공에서 시작해 2030 월드컵까지 이어지는 100부작 숏폼 시리즈를
**명령어 한 줄로 100편 전부** 만들어 내는 파이프라인입니다.

```bash
# 한국어 내레이션
python3 -m india2030 make --range 1-100 --workers 4

# 힌디어 내레이션 (인도 현지용)
python3 -m india2030 make --range 1-100 --workers 4 --lang hi

# 힌디어 내레이션 + 한국어 자막
python3 -m india2030 make --range 1-100 --workers 4 --lang hi --caption-lang ko
```

- 100개 소제목이 **한국어·힌디어 두 벌** 내장되어 있고, 각 편은 **HOOK → EMOTION → ACTION → DREAM → MESSAGE**
  5단계로 구성된 **정확히 60초** 완결 서사로 만들어집니다.
- 내레이션 언어와 자막 언어를 따로 고를 수 있습니다(`--lang` / `--caption-lang`).
- 외부 API 키가 없어도 동작합니다(오프라인 템플릿 대본 + 절차적 배경 생성 + 무음 폴백).
  키가 있으면 Claude 대본·고품질 TTS로 바로 품질이 올라갑니다.
- 결과물: `mp4` 영상, 썸네일 `jpg`, 대본 `json`, 자막 `srt`, 업로드용 `upload_index.csv`.

---

## 1. 설치

```bash
# 1) ffmpeg (필수)
sudo apt-get install -y ffmpeg          # Ubuntu/Debian
brew install ffmpeg                     # macOS
#   윈도우는 https://www.gyan.dev/ffmpeg/builds/ 에서 받아 PATH 에 추가

# 2) 폰트 (자막 깨짐 방지 — 리눅스에서 권장)
sudo apt-get install -y fonts-nanum          # 한국어 자막
sudo apt-get install -y fonts-lohit-deva     # 힌디어(데바나가리) 자막

# 3) 파이썬 패키지
pip install -r requirements.txt

# 4) 점검
python3 -m india2030 check
```

`check` 출력 예시:

```
  ffmpeg      : /usr/bin/ffmpeg
  ffprobe     : /usr/bin/ffprobe
  Pillow      : 12.3.0
  한글 폰트    : /usr/share/fonts/truetype/nanum/NanumGothicBold.ttf
  힌디 폰트    : /usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf
  언어 설정    : 내레이션 hi / 자막 ko · 보이스 hi-IN-MadhurNeural
  TTS 가능    : edge, gtts, silent
```

> 언어 설정을 바꿔 확인하려면 `python3 -m india2030 check --lang hi --caption-lang ko`

## 2. 바로 실행

```bash
# 1편만 테스트
python3 -m india2030 make --range 1

# 100편 전부 (권장)
./run_all.sh            # 또는  make all
```

중간에 멈춰도 **다시 실행하면 이미 만든 회차는 건너뛰고 이어서** 만듭니다.
처음부터 다시 만들려면 `--overwrite` 를 붙이세요.

## 3. 명령어

| 명령 | 설명 |
| --- | --- |
| `python3 -m india2030 list` | 100개 소제목을 ACT 별로 출력 (`--act 3`, `--lang hi` 로 필터/언어 변경) |
| `python3 -m india2030 script --range 1-100 --print` | 대본(JSON/SRT)만 생성·확인 |
| `python3 -m india2030 make --range 1-100` | 영상 생성 |
| `python3 -m india2030 check` | 환경 점검 |

### `make` 주요 옵션

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `--range 1-100` | `1-100` | 회차 범위. `--range 5`, `--range 1-20,55,91-95` 형태 모두 가능 |
| `--lang hi` | `ko` | **내레이션 언어** — `ko`(한국어) / `hi`(힌디어) |
| `--caption-lang ko` | 내레이션과 동일 | **화면 자막 언어** — 힌디 더빙 + 한국어 자막 조합에 사용 |
| `--workers 4` | `2` | 동시 처리 편수 (CPU 코어 수 정도가 적당) |
| `--aspect 9:16` | `9:16` | `9:16`(쇼츠/릴스), `1:1`, `16:9` |
| `--tts edge` | `auto` | `auto\|edge\|gtts\|elevenlabs\|silent` |
| `--voice hi-IN-MadhurNeural` | 언어별 기본 | 한국어 `ko-KR-InJoonNeural`(남)/`ko-KR-SunHiNeural`(여), 힌디어 `hi-IN-MadhurNeural`(남)/`hi-IN-SwaraNeural`(여) |
| `--images stock` | `pillow` | `assets/stock/ep001/` 의 실제 사진 사용 |
| `--bgm assets/bgm` | 없음 | 배경음악 파일 또는 폴더 (`--bgm-gain -18` 로 볼륨 조절) |
| `--script-provider llm` | `template` | Claude API 로 대본 생성 (아래 4번 참고) |
| `--transition xfade` | `xfade` | 비트 전환: `xfade`(크로스페이드) / `fade` / `cut` |
| `--preset veryfast --crf 26` | `medium`/`20` | 빠른 미리보기용 인코딩 |
| `--no-subtitle` | 켜짐 | 화면 자막 번인 끄기 |
| `--overwrite` | 꺼짐 | 이미 만든 영상도 다시 생성 |
| `--dry-run` | 꺼짐 | 렌더링 없이 대본만 확인 |

## 4. 품질 올리기 (선택)

### 4-1. 내레이션 음성

기본은 무료 `edge-tts` 를 자동으로 씁니다. 언어를 바꾸면 보이스도 자동으로 바뀝니다.

```bash
pip install edge-tts

# 한국어 남성
python3 -m india2030 make --range 1-100 --tts edge --voice ko-KR-InJoonNeural
# 힌디어 남성(기본) / 여성
python3 -m india2030 make --range 1-100 --lang hi --tts edge
python3 -m india2030 make --range 1-100 --lang hi --tts edge --voice hi-IN-SwaraNeural
```

ElevenLabs 를 쓰려면:

```bash
export ELEVENLABS_API_KEY=...            # 필수
export ELEVENLABS_VOICE_ID=...           # 사용할 보이스 ID
python3 -m india2030 make --range 1-100 --tts elevenlabs
```

> 어떤 엔진도 접속되지 않으면 **무음 트랙**으로 대체되어 영상 제작은 계속됩니다.
> (`check` 명령의 `TTS 가능` 목록으로 미리 확인하세요.)

### 4-2. 대본을 Claude 로 생성

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python3 -m india2030 make --range 1-100 --script-provider llm
```

- 회차별 ACT·무드·연출 메모·스포일러 금지 조건과 **내레이션 언어**가 프롬프트에 자동으로 반영됩니다.
- API 호출이 실패하면 그 회차만 조용히 템플릿 대본으로 되돌아갑니다.

### 4-3. 실사 이미지 / AI 이미지 사용

`assets/stock/ep001/` 처럼 회차 폴더에 이미지 5장을 넣고:

```bash
python3 -m india2030 make --range 1-100 --images stock
```

어떤 그림이 필요한지는 대본 JSON 의 `image_prompt`(영어) / `visual`(촬영 지시문)에
회차·비트별로 적혀 있습니다. 미드저니·Firefly 등에 그대로 붙여 넣어 쓰면 됩니다.

```bash
python3 -m india2030 script --range 1-100
python3 -c "import json;print(json.load(open('output/script/ep001.json'))['beats'][0]['image_prompt'])"
```

### 4-4. 배경음악

`assets/bgm/` 에 음원을 넣고 `--bgm assets/bgm` 을 주면 회차별로 돌아가며 깔립니다.
상업적 업로드 시 라이선스가 확인된 음원만 사용하세요.

## 5. 결과물 구조

```
output/
├── video/
│   ├── ep001_꿈.mp4          # 60초 완성 영상
│   ├── ep001_thumb.jpg       # 썸네일
│   └── ...
├── script/
│   ├── ep001.json            # 5단계 대본 + 자막 + 이미지 프롬프트 + 해시태그
│   ├── ep001.hi.srt          # 내레이션 언어 자막(업로드용)
│   ├── ep001.ko.srt          # 자막 언어가 다르면 함께 생성
│   └── ...
├── manifest.json             # 생성 결과 요약 (성공/실패/길이/사용 엔진)
└── upload_index.csv          # 업로드용 표 (제목·파일·해시태그) — 엑셀에서 바로 열림
```

대본 JSON 예시:

```json
{
  "no": 1,
  "hook_title": "[1화] 쓰레기 더미 옆 바람 빠진 공 하나, 맨발 소년의 손에 들어오다",
  "beats": [
    {
      "name": "HOOK",
      "seconds": 8.0,
      "narration": "쓰레기 더미 옆, 바람 빠진 공 하나. 맨발의 소년이 그것을 집어 들었다.",
      "caption": "쓰레기 더미 옆, 바람 빠진 공 하나",
      "visual": "바람 빠진 낡은 축구공",
      "image_prompt": "cinematic close-up, a deflated old football in red dust, ..."
    }
  ]
}
```

## 6. 시리즈 구성

| ACT | 회차 | 제목 | 색감/무드 |
| --- | --- | --- | --- |
| 1 | 1~20 | 꿈 — 소년의 첫 축구공 | 흙먼지 황토빛 노을 |
| 2 | 21~40 | 성장 — 훈련과 실패 | 새벽 푸른빛 |
| 3 | 41~60 | 도전 — 지역에서 국가 무대로 | 잔디 초록빛 |
| 4 | 61~80 | 국가대표 — 국가대표의 꿈 | 조명 자주빛 |
| 5 | 81~100 | 2030 — 인도의 월드컵 도전 | 오렌지빛 물결 |

힌디어 제목은 `python3 -m india2030 list --lang hi` 로 확인할 수 있습니다.

제작 메모는 코드에 반영되어 있습니다.

- **91~95화**는 다음 화 예고로 이어지도록 끝나며, **결과를 절대 노출하지 않습니다.**
- **88화**는 1화와 같은 구도(순환 구조)로 연출됩니다.
- **100화**는 `ONE BOY. ONE BALL. ONE DREAM. ONE NATION.` 슬로건으로 마무리됩니다.

## 7. 제작 시간 참고

1080x1920 / 30fps 기준 한 편의 렌더링 시간은 **CPU 성능에 크게 좌우**됩니다.
(참고: 2코어 컨테이너에서 워커 3 · `--preset veryfast` 로 한 편당 약 2분)

빠르게 뽑고 싶다면:

```bash
python3 -m india2030 make --range 1-100 --workers 8 --preset veryfast --crf 26
```

먼저 `--range 1-3` 으로 시간을 재보고 100편 소요 시간을 가늠하는 것을 권합니다.

## 8. 구조

```
india2030/
├── episodes.py      100개 소제목(한국어) + ACT 메타데이터(색감·무드·연출 메모)
├── langs.py         언어 팩 — 힌디어 100개 제목 + 언어별 문장 뱅크/보이스
├── scriptgen.py     5단계 60초 대본 생성 (템플릿 엔진, 내레이션·자막 언어 분리)
├── config.py        설정 / 비트 길이 / 폰트 탐색
├── ffmpeg.py        ffmpeg·ffprobe 래퍼
├── video.py         켄번즈·자막 오버레이·크로스페이드·BGM 믹스
├── pipeline.py      한 편을 끝까지 만드는 조립 라인 + SRT/매니페스트
├── cli.py           커맨드라인
└── providers/
    ├── llm.py       Claude 대본 생성 (선택)
    ├── tts.py       edge-tts / gTTS / ElevenLabs / 무음 폴백
    └── image.py     절차적 배경 생성 + 텍스트 오버레이 + 스톡 이미지 크롭
```

## 9. 테스트

```bash
make test        # 또는 python3 -m unittest discover -s tests
```

## 10. 자주 겪는 문제

| 증상 | 해결 |
| --- | --- |
| `ffmpeg 을 찾을 수 없습니다` | ffmpeg 설치 또는 `pip install imageio-ffmpeg` |
| 한국어 자막이 네모(□)로 나옴 | `sudo apt-get install fonts-nanum` 또는 `--font /경로/폰트.ttf` |
| 힌디어 자막이 깨지거나 모음이 어긋남 | `sudo apt-get install fonts-lohit-deva`, 그리고 Pillow 가 Raqm 지원으로 빌드됐는지 확인(`python3 -c "from PIL import features; print(features.check('raqm'))"`) |
| 음성이 안 나옴 | `check` 의 `TTS 가능` 확인 → `pip install edge-tts`, 사내망이면 프록시/방화벽 확인 |
| 너무 느림 | `--preset veryfast --crf 26 --workers 8` |
| 특정 회차만 다시 | `python3 -m india2030 make --range 42 --overwrite` |
