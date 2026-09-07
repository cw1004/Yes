/**
 * 카메라 제어 + 실시간 촬영 품질 피드백.
 * 셔터를 누르기 전에 조명/초점/거리를 잡아주는 게 재촬영률을 줄이는 가장 싼 방법이다.
 */
import { assessQuality, fallbackFaceBox } from '../engine/quality.js';

export class Camera {
  constructor({ video, hintEl, ovalEl, onReady }) {
    this.video = video;
    this.hintEl = hintEl;
    this.ovalEl = ovalEl;
    this.onReady = onReady;
    this.facingMode = 'user';
    this.stream = null;
    this.timer = null;
    this.detector = null;
    this.lastBox = null;
  }

  async start() {
    await this.stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      this.hint(location.protocol === 'https:' || location.hostname === 'localhost'
        ? '이 브라우저는 카메라를 지원하지 않습니다. 아래 ‘사진 · 앨범’에서 선택해 주세요.'
        : '카메라는 보안 연결(HTTPS)에서만 열립니다. 아래 ‘사진 · 앨범’에서 선택해 주세요.', false);
      throw new Error('getUserMedia 미지원');
    }
    try {
      this.stream = await this.openStream({ width: { ideal: 1280 }, height: { ideal: 1706 } });
    } catch (err) {
      // 요청한 해상도를 못 맞추는 기기가 많다. 제약을 풀고 한 번 더 시도한다.
      if (err.name === 'OverconstrainedError') {
        try { this.stream = await this.openStream({}); } catch (retry) { this.failWith(retry); }
      } else {
        this.failWith(err);
      }
    }
    if (!this.stream) throw new Error('카메라 스트림 없음');
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    if ('FaceDetector' in window) {
      try { this.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 }); } catch { /* 미지원 */ }
    }
    this.loop();
  }

  openStream(extra) {
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facingMode, ...extra },
      audio: false,
    });
  }

  /** 오류 코드를 그대로 보여주면 사용자는 무엇을 해야 할지 알 수 없다 */
  failWith(err) {
    const MESSAGES = {
      NotAllowedError: '카메라 권한이 꺼져 있습니다. 브라우저 주소창의 자물쇠 아이콘에서 카메라를 허용한 뒤 다시 시도해 주세요.',
      PermissionDeniedError: '카메라 권한이 꺼져 있습니다. 설정에서 허용한 뒤 다시 시도해 주세요.',
      NotFoundError: '이 기기에서 카메라를 찾지 못했습니다. 아래 ‘사진 · 앨범’에서 사진을 선택해 주세요.',
      NotReadableError: '다른 앱이 카메라를 쓰고 있습니다. 그 앱을 닫고 다시 시도해 주세요.',
      AbortError: '카메라를 여는 중 중단됐습니다. 다시 시도해 주세요.',
      SecurityError: '카메라는 보안 연결(HTTPS)에서만 열립니다. 아래 ‘사진 · 앨범’에서 선택해 주세요.',
    };
    console.warn('[camera]', err.name, err.message);
    this.hint(MESSAGES[err.name] || '카메라를 열 수 없습니다. 아래 ‘사진 · 앨범’에서 사진을 선택해 주세요.', false);
    throw err;
  }

  async stop() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  async flip() {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    await this.start();
  }

  hint(text, ok) {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('ok', !!ok);
    this.ovalEl.classList.toggle('ok', !!ok);
  }

  /** 저해상도 프레임을 주기적으로 떠서 품질만 본다 (배터리 절약) */
  loop() {
    clearInterval(this.timer);
    this.timer = setInterval(async () => {
      const frame = this.grabFrame(240);
      if (!frame) return;
      const box = await this.detectBox(frame);
      const q = assessQuality(frame, box);
      this.lastBox = box;
      if (q.issues.length) this.hint(q.issues[0].message, false);
      else this.hint('좋습니다. 이 상태로 촬영하세요 ✓', true);
      this.onReady?.(q.issues.length === 0);
    }, 420);
  }

  async detectBox(frame) {
    if (this.detector) {
      try {
        const faces = await this.detector.detect(this.video);
        if (faces?.length) {
          const b = faces[0].boundingBox;
          const sx = frame.width / this.video.videoWidth;
          const sy = frame.height / this.video.videoHeight;
          return { x: b.x * sx, y: b.y * sy, width: b.width * sx, height: b.height * sy };
        }
      } catch { /* 감지 실패 시 가이드 박스로 */ }
    }
    return fallbackFaceBox(frame.width, frame.height);
  }

  /** 현재 프레임을 ImageData 로 (targetW 기준 리사이즈) */
  grabFrame(targetW = 640) {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return null;
    const w = targetW;
    const h = Math.round((vh / vw) * targetW);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    img.canvas = canvas;
    return img;
  }
}

/** 파일 업로드 경로 — 카메라 권한이 없는 데스크톱/구형 기기 대응 */
export function imageDataFromFile(file, targetW = 640) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = targetW;
      const h = Math.round((img.height / img.width) * targetW);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const data = ctx.getImageData(0, 0, w, h);
      data.canvas = canvas;
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다.')); };
    img.src = url;
  });
}
