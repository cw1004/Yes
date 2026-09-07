/**
 * 색공간 변환 유틸.
 * 피부 분석의 모든 수치는 sRGB -> CIE Lab 로 옮긴 뒤 계산한다.
 * (RGB 평균만으로는 조명 차이에 너무 취약하다.)
 */

const D65 = { x: 95.047, y: 100.0, z: 108.883 };

export function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function rgbToXyz(r, g, b) {
  const R = srgbToLinear(r) * 100;
  const G = srgbToLinear(g) * 100;
  const B = srgbToLinear(b) * 100;
  return {
    x: R * 0.4124 + G * 0.3576 + B * 0.1805,
    y: R * 0.2126 + G * 0.7152 + B * 0.0722,
    z: R * 0.0193 + G * 0.1192 + B * 0.9505,
  };
}

const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab(r, g, b) {
  const { x, y, z } = rgbToXyz(r, g, b);
  const fx = f(x / D65.x);
  const fy = f(y / D65.y);
  const fz = f(z / D65.z);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function rgbToYCbCr(r, g, b) {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cb: 128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    cr: 128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  };
}

export function rgbToHsv(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * ITA° (Individual Typology Angle) — 피부색 분류의 사실상 표준 지표.
 * 값이 클수록 밝은 피부. Fitzpatrick 유형과 대응시켜 사용한다.
 */
export function ita(L, b) {
  return (Math.atan((L - 50) / (b || 1e-6)) * 180) / Math.PI;
}

export function itaToCategory(value) {
  if (value > 55) return { key: 'very_light', label: '베리 라이트', fitzpatrick: 'I' };
  if (value > 41) return { key: 'light', label: '라이트', fitzpatrick: 'II' };
  if (value > 28) return { key: 'intermediate', label: '인터미디엇', fitzpatrick: 'III' };
  if (value > 10) return { key: 'tan', label: '탠', fitzpatrick: 'IV' };
  if (value > -30) return { key: 'brown', label: '브라운', fitzpatrick: 'V' };
  return { key: 'dark', label: '다크', fitzpatrick: 'VI' };
}

/** Lab -> #RRGGBB (스와치 렌더링용) */
export function labToHex(L, a, bb) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = (D65.x * inv(fx)) / 100;
  const y = (D65.y * inv(fy)) / 100;
  const z = (D65.z * inv(fz)) / 100;
  const lin = [
    x * 3.2406 + y * -1.5372 + z * -0.4986,
    x * -0.9689 + y * 1.8758 + z * 0.0415,
    x * 0.0557 + y * -0.204 + z * 1.057,
  ];
  const hex = lin
    .map((v) => {
      const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
      return Math.round(Math.min(255, Math.max(0, c * 255)))
        .toString(16)
        .padStart(2, '0');
    })
    .join('');
  return `#${hex}`;
}

export const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
