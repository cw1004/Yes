/**
 * 촬영 품질 게이트.
 * 흐리거나 어두운 사진으로 진단을 내리면 결과 신뢰도가 무너지고
 * 그대로 결제까지 이어지면 환불 요청이 된다. 분석 전에 먼저 막는다.
 */
export function assessQuality(img, box) {
  const { data, width, height } = img;
  let sum = 0, n = 0;
  const gray = new Float32Array(width * height);
  for (let p = 0; p < gray.length; p++) {
    const i = p * 4;
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const x0 = Math.max(1, box.x | 0), y0 = Math.max(1, box.y | 0);
  const x1 = Math.min(width - 1, (box.x + box.width) | 0);
  const y1 = Math.min(height - 1, (box.y + box.height) | 0);
  const laps = [];
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const p = y * width + x;
      sum += gray[p];
      n++;
      laps.push(4 * gray[p] - gray[p - 1] - gray[p + 1] - gray[p - width] - gray[p + width]);
    }
  }
  const brightness = n ? sum / n : 0;
  const m = laps.reduce((s, v) => s + v, 0) / (laps.length || 1);
  const sharpness = laps.reduce((s, v) => s + (v - m) ** 2, 0) / (laps.length || 1);
  const faceRatio = (box.width * box.height) / (width * height);

  const issues = [];
  if (brightness < 55) issues.push({ code: 'dark', message: '너무 어둡습니다. 창가나 밝은 조명 쪽으로 이동해 주세요.' });
  if (brightness > 215) issues.push({ code: 'bright', message: '빛이 너무 강합니다. 직사광선을 피해 주세요.' });
  if (sharpness < 45) issues.push({ code: 'blur', message: '초점이 흔들렸습니다. 카메라를 고정하고 다시 촬영해 주세요.' });
  if (faceRatio < 0.06) issues.push({ code: 'small', message: '얼굴이 작게 잡혔습니다. 화면 가이드에 얼굴을 맞춰 주세요.' });

  const confidence = Math.max(
    0,
    Math.min(100, Math.round(
      100 - issues.length * 22 -
      Math.max(0, 55 - brightness) * 0.5 -
      Math.max(0, 45 - sharpness) * 0.4
    ))
  );
  return { brightness: Math.round(brightness), sharpness: Math.round(sharpness), faceRatio: Math.round(faceRatio * 1000) / 1000, issues, confidence, ok: issues.length === 0 };
}

/** FaceDetector 가 없을 때 쓰는 중앙 가이드 박스 (촬영 가이드 타원과 동일 비율) */
export function fallbackFaceBox(width, height) {
  const w = Math.round(width * 0.62);
  const h = Math.round(height * 0.72);
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2 * 0.9), width: w, height: h };
}
