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
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facingMode, width: { ideal: 1280 }, height: { ideal: 1706 } },
        audio: false,
      });
    } catch (err) {
      this.hint(`카메라를 열 수 없습니다 (${err.name}). '사진 선택'으로도 진단할 수 있습니다.`, false);
      throw err;
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    if ('FaceDetector' in window) {
      try { this.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 }); } catch { /* 미지원 */ }
    }
    this.loop();
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
