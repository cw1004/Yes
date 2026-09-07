/**
 * 피부 픽셀 마스크 + 얼굴 존(zone) 분할.
 *
 * 랜드마크 모델 없이도 동작해야 하므로(오프라인/저사양 기기 대응)
 * 1) YCbCr + HSV 복합 규칙으로 피부 픽셀을 뽑고
 * 2) 얼굴 박스를 인체 비율 기준으로 T존/U존/눈밑/이마로 나눈다.
 * FaceDetector API 가 있는 브라우저에서는 정확한 얼굴 박스가 들어오고,
 * 없으면 중앙 타원 박스가 들어온다. 어느 쪽이든 같은 코드가 돈다.
 */
import { rgbToYCbCr, rgbToHsv } from './color.js';

/**
 * 단일 픽셀이 피부색 범위인지 판정.
 *
 * 밝기 하한(vFloor/rFloor)은 고정하지 않는다. 절대값으로 박아두면
 * 짙은 피부톤(Fitzpatrick V~VI)이 실내 조명에서 통째로 '피부 아님'으로 떨어진다.
 * 색상(cb/cr)과 채널 간 관계(r>b, r-g)는 톤과 무관하게 유지되므로 그쪽으로 판별하고,
 * 밝기 하한은 호출부가 이미지 평균에서 계산해 넘긴다.
 */
export function isSkinPixel(r, g, b, { vFloor = 0.12, rFloor = 32 } = {}) {
  const { cb, cr } = rgbToYCbCr(r, g, b);
  const { h, s, v } = rgbToHsv(r, g, b);
  const ycc = cb >= 77 && cb <= 135 && cr >= 133 && cr <= 180;
  const hsv = (h <= 50 || h >= 335) && s >= 0.12 && s <= 0.82 && v >= vFloor;
  const rgb = r > rFloor && g > rFloor * 0.5 && b > rFloor * 0.25 && r > b && r - g > 7;
  // 세 규칙 중 둘 이상 만족해야 피부로 본다 (머리카락/배경 오검출 억제)
  return (ycc ? 1 : 0) + (hsv ? 1 : 0) + (rgb ? 1 : 0) >= 2;
}

/** 얼굴 영역의 밝기에서 하한을 역산한다 (어두운 사진·짙은 톤 모두 대응) */
export function adaptiveFloors(img, box) {
  const { data, width, height } = img;
  let sumV = 0, sumR = 0, n = 0;
  const x0 = Math.max(0, box.x | 0), y0 = Math.max(0, box.y | 0);
  const x1 = Math.min(width, (box.x + box.width) | 0), y1 = Math.min(height, (box.y + box.height) | 0);
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const i = (y * width + x) * 4;
      sumV += Math.max(data[i], data[i + 1], data[i + 2]);
      sumR += data[i];
      n++;
    }
  }
  if (!n) return { vFloor: 0.12, rFloor: 32 };
  const meanV = sumV / n / 255;
  const meanR = sumR / n;
  return {
    vFloor: Math.min(0.24, Math.max(0.05, meanV * 0.42)),
    rFloor: Math.min(70, Math.max(22, meanR * 0.42)),
  };
}

/**
 * @param {{data:Uint8ClampedArray,width:number,height:number}} img
 * @param {{x:number,y:number,width:number,height:number}} box 얼굴 박스(픽셀)
 * @returns {{mask:Uint8Array,count:number,width:number,height:number}}
 */
export function buildSkinMask(img, box) {
  const { data, width, height } = img;
  const floors = adaptiveFloors(img, box);
  const mask = new Uint8Array(width * height);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = box.width / 2;
  const ry = box.height / 2;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const ny = (y - cy) / ry;
    for (let x = 0; x < width; x++) {
      const nx = (x - cx) / rx;
      if (nx * nx + ny * ny > 1) continue; // 얼굴 타원 밖은 버린다
      const i = (y * width + x) * 4;
      if (isSkinPixel(data[i], data[i + 1], data[i + 2], floors)) {
        mask[y * width + x] = 1;
        count++;
      }
    }
  }
  return { mask, count, width, height };
}

/**
 * 얼굴 박스를 해부학적 비율로 나눈 존 사각형들.
 * y 비율은 표준 얼굴 3분할(이마/중안면/하안면)에 근거한다.
 */
export function faceZones(box) {
  const { x, y, width: w, height: h } = box;
  const rect = (fx, fy, fw, fh) => ({
    x: Math.round(x + fx * w),
    y: Math.round(y + fy * h),
    width: Math.round(fw * w),
    height: Math.round(fh * h),
  });
  return {
    forehead: { label: '이마', ...rect(0.22, 0.1, 0.56, 0.18) },
    nose: { label: '코', ...rect(0.38, 0.4, 0.24, 0.22) },
    leftCheek: { label: '왼쪽 볼', ...rect(0.1, 0.45, 0.22, 0.22) },
    rightCheek: { label: '오른쪽 볼', ...rect(0.68, 0.45, 0.22, 0.22) },
    chin: { label: '턱', ...rect(0.35, 0.74, 0.3, 0.16) },
    underEyeLeft: { label: '왼쪽 눈밑', ...rect(0.16, 0.36, 0.2, 0.09) },
    underEyeRight: { label: '오른쪽 눈밑', ...rect(0.64, 0.36, 0.2, 0.09) },
    eyeCornerLeft: { label: '왼쪽 눈가', ...rect(0.06, 0.3, 0.14, 0.12) },
    eyeCornerRight: { label: '오른쪽 눈가', ...rect(0.8, 0.3, 0.14, 0.12) },
  };
}

/** T존 = 이마+코, U존 = 양볼+턱 */
export const T_ZONE = ['forehead', 'nose'];
export const U_ZONE = ['leftCheek', 'rightCheek', 'chin'];

/** 존 사각형 안의 피부 픽셀 인덱스를 순회 */
export function forEachZonePixel(img, maskObj, zone, fn) {
  const { width } = img;
  const x0 = Math.max(0, zone.x);
  const y0 = Math.max(0, zone.y);
  const x1 = Math.min(img.width, zone.x + zone.width);
  const y1 = Math.min(img.height, zone.y + zone.height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      if (maskObj && !maskObj.mask[p]) continue;
      fn(p * 4, x, y, p);
    }
  }
}
