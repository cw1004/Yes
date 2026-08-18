# 실사/스톡 이미지 넣는 곳 (선택)

기본값은 Pillow 로 그린 실루엣 배경이지만, 직접 준비한 사진·AI 생성 이미지를
쓰고 싶다면 회차 폴더를 만들고 이미지를 넣으세요.

```
assets/stock/ep001/1.jpg   # HOOK
assets/stock/ep001/2.jpg   # EMOTION
assets/stock/ep001/3.jpg   # ACTION
assets/stock/ep001/4.jpg   # DREAM
assets/stock/ep001/5.jpg   # MESSAGE
```

- 파일명 정렬 순서대로 5개 비트에 배정되며, 5장보다 적으면 순환 사용합니다.
- 화면비에 맞춰 자동으로 중앙 크롭됩니다(세로 영상이면 1080x1920).
- 실행: `python3 -m india2030 make --range 1-100 --images stock`

각 회차에 어떤 그림이 필요한지는 `output/script/ep001.json` 의
`image_prompt` (영어 프롬프트) / `visual` (촬영 지시문) 필드를 참고하세요.
