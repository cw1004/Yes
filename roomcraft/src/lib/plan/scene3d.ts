import * as THREE from 'three'
import type { Product } from '../../types'
import type { DesignStyle } from '../../types'
import type { FloorPlan, PlacedItem, Room } from './types'
import { dimsOf } from './clearance'
import { materialsFor } from '../room/scene'

/**
 * 평면도를 그대로 3D 로 세웁니다.
 *
 * 별도의 3D 데이터를 만들지 않습니다. 이미 mm 단위로 있는 평면(방·개구부·배치 가구)이
 * 유일한 원본이고, 여기서는 그것을 높이만 부여해 입체로 올립니다. 두 벌을 유지하면
 * 평면에서 옮긴 소파가 3D 에서는 그대로인 상태가 반드시 생깁니다.
 *
 * 단위는 three 안에서도 mm 를 그대로 씁니다. 축척을 바꾸면 카메라·조명 거리까지
 * 전부 환산해야 해서 실수가 늘어납니다.
 */

const CEILING = 2400
const WALL_T = 150

export interface SceneHandles {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  /** 가구 메시 → 배치 항목 id (클릭 선택에 씁니다) */
  pickable: THREE.Object3D[]
  dispose: () => void
}

const hexToColor = (hex: string) => new THREE.Color(hex)

/** 방 바닥 + 벽을 세웁니다. */
function buildShell(group: THREE.Group, plan: FloorPlan, wallColor: string, floorColor: string): void {
  const floorMat = new THREE.MeshStandardMaterial({ color: hexToColor(floorColor), roughness: 0.85 })
  /*
   * 벽은 안쪽 면만 그립니다(BackSide).
   * 양면으로 두면 카메라와 방 사이의 벽이 화면을 통째로 가려서, 방을 보려면 매번
   * 카메라를 벽 안쪽으로 밀어 넣어야 합니다. 실내 뷰어의 표준적인 처리입니다.
   */
  const wallMat = new THREE.MeshStandardMaterial({
    color: hexToColor(wallColor),
    roughness: 0.95,
    side: THREE.BackSide,
  })

  for (const room of plan.rooms) {
    // 바닥
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.w, room.h), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(room.x + room.w / 2, 0, room.y + room.h / 2)
    floor.receiveShadow = true
    group.add(floor)

    // 발코니는 벽을 세우지 않습니다 — 거실에서 이어지는 공간입니다.
    if (room.kind === 'balcony') continue
  }

  /*
   * 벽은 방마다 세우지 않고 도면 외곽 + 내부 칸막이로 한 번만 세웁니다.
   * 방마다 4면을 세우면 인접한 방 사이에 벽이 두 겹으로 생겨 두께가 두 배로 보입니다.
   */
  const walls = collectWalls(plan)
  for (const w of walls) {
    const geo = new THREE.BoxGeometry(w.w, CEILING, w.h)
    const mesh = new THREE.Mesh(geo, wallMat)
    mesh.position.set(w.x + w.w / 2, CEILING / 2, w.y + w.h / 2)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
}

interface WallSeg {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 방 경계에서 벽 선분을 모읍니다.
 *
 * 같은 선분이 두 방에서 각각 나오므로(공유 벽) 위치로 중복을 제거합니다.
 * 그러지 않으면 z-fighting 으로 벽면이 지글거립니다.
 */
function collectWalls(plan: FloorPlan): WallSeg[] {
  const segs = new Map<string, WallSeg>()
  const add = (s: WallSeg) => {
    const key = `${Math.round(s.x)}|${Math.round(s.y)}|${Math.round(s.w)}|${Math.round(s.h)}`
    if (!segs.has(key)) segs.set(key, s)
  }

  for (const r of plan.rooms) {
    if (r.kind === 'balcony') continue
    add({ x: r.x - WALL_T / 2, y: r.y - WALL_T / 2, w: r.w + WALL_T, h: WALL_T })
    add({ x: r.x - WALL_T / 2, y: r.y + r.h - WALL_T / 2, w: r.w + WALL_T, h: WALL_T })
    add({ x: r.x - WALL_T / 2, y: r.y - WALL_T / 2, w: WALL_T, h: r.h + WALL_T })
    add({ x: r.x + r.w - WALL_T / 2, y: r.y - WALL_T / 2, w: WALL_T, h: r.h + WALL_T })
  }
  return [...segs.values()]
}

/**
 * 가구를 상자로 세웁니다.
 *
 * 실루엣마다 형태를 다르게 하면 좋겠지만, 지금 필요한 것은 "이 크기의 물건이 여기
 * 있으면 방이 어떻게 느껴지는가" 입니다. 부피와 높이가 맞는 상자만으로도 그 판단은
 * 됩니다 — 오히려 형태를 어설프게 흉내 내면 실제 제품으로 오인하게 됩니다.
 */
function buildFurniture(
  group: THREE.Group,
  items: PlacedItem[],
  productBySku: (sku: string) => Product | undefined,
  pickable: THREE.Object3D[],
): void {
  for (const item of items) {
    const product = productBySku(item.sku)
    if (!product) continue
    const d = dimsOf(product)
    if (d.w <= 0) continue

    const isRug = product.silhouette === 'rug'
    const mat = new THREE.MeshStandardMaterial({
      color: hexToColor(product.swatch),
      roughness: isRug ? 1 : 0.7,
      metalness: product.silhouette === 'faucet' || product.silhouette === 'hardware' ? 0.6 : 0.05,
    })

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(d.w, Math.max(d.h, 12), d.d), mat)
    mesh.position.set(item.x, Math.max(d.h, 12) / 2, item.y)
    mesh.rotation.y = (-item.rot * Math.PI) / 180
    mesh.castShadow = !isRug
    mesh.receiveShadow = true
    mesh.userData.itemId = item.id
    group.add(mesh)
    pickable.push(mesh)

    // 보조색이 있으면 상판/쿠션 느낌의 띠를 하나 얹어 밋밋함을 줄입니다.
    if (product.swatch2 && !isRug && d.h > 200) {
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(d.w * 0.96, Math.max(40, d.h * 0.12), d.d * 0.96),
        new THREE.MeshStandardMaterial({ color: hexToColor(product.swatch2), roughness: 0.6 }),
      )
      band.position.set(item.x, Math.max(d.h, 12) - Math.max(40, d.h * 0.12) / 2, item.y)
      band.rotation.y = (-item.rot * Math.PI) / 180
      band.castShadow = true
      band.userData.itemId = item.id
      group.add(band)
      pickable.push(band)
    }
  }
}

export interface BuildOptions {
  plan: FloorPlan
  items: PlacedItem[]
  style: DesignStyle
  productBySku: (sku: string) => Product | undefined
  canvas: HTMLCanvasElement
}

export function buildScene(o: BuildOptions): SceneHandles {
  const { m } = materialsFor(o.style)

  const scene = new THREE.Scene()
  // 배경은 벽 색을 어둡게 깔아 화면 밖이 방과 이질적으로 보이지 않게 합니다.
  scene.background = hexToColor(m.wall).clone().multiplyScalar(0.5)

  const group = new THREE.Group()
  buildShell(group, o.plan, m.wall, m.floor)
  const pickable: THREE.Object3D[] = []
  buildFurniture(group, o.items, o.productBySku, pickable)
  scene.add(group)

  /*
   * 조명.
   * 창이 있는 쪽(남향 = +z)에서 들어오는 주광 하나와 약한 환경광으로 시작합니다.
   * 광원이 하나면 그림자 방향이 분명해져서 부피감이 읽힙니다.
   */
  const sun = new THREE.DirectionalLight(hexToColor(m.lightWarm), 2.1 * m.lightPower)
  sun.position.set(o.plan.width * 0.7, 4200, o.plan.height * 1.5)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const span = Math.max(o.plan.width, o.plan.height)
  sun.shadow.camera.left = -span
  sun.shadow.camera.right = span
  sun.shadow.camera.top = span
  sun.shadow.camera.bottom = -span
  sun.shadow.camera.far = span * 4
  scene.add(sun)

  /*
   * 천장이 없어 빛이 위로 빠져나갑니다. 게다가 하늘색으로 벽 색을 그대로 쓰면
   * 벽에 자기 색이 두 번 곱해져 전체가 탁해집니다(처음에 그렇게 나왔습니다).
   * 하늘은 중성 주광, 바닥 반사만 바닥 색으로 둡니다.
   */
  scene.add(new THREE.HemisphereLight(0xdfe6ee, hexToColor(m.floor), 2.0))
  // 그림자 안쪽이 완전히 죽지 않도록 약한 채움광을 더합니다.
  scene.add(new THREE.AmbientLight(0xffffff, 0.35))

  // 실내는 화각이 좁으면 방이 좁아 보입니다. 62도는 실내 렌더에서 흔히 쓰는 값입니다.
  const camera = new THREE.PerspectiveCamera(62, 1, 60, span * 8)

  const renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))

  return {
    scene,
    camera,
    renderer,
    pickable,
    dispose: () => {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else if (mat) (mat as THREE.Material).dispose()
      })
      renderer.dispose()
    },
  }
}

/**
 * 방 안에서 중심을 바라보는 카메라.
 *
 * 거리를 고정값으로 주면 안 됩니다. 방마다 크기가 달라서 어떤 방에서는 카메라가
 * 벽을 뚫고 나가고(화면이 벽 하나로 덮임), 어떤 방에서는 너무 가까워집니다.
 * 바라보는 방향으로 벽까지 남은 거리를 구해 그 안쪽에 세웁니다.
 */
export function orbitInside(
  camera: THREE.PerspectiveCamera,
  room: Room,
  yaw: number,
  pitch: number,
  zoom: number,
): void {
  const cx = room.x + room.w / 2
  const cz = room.y + room.h / 2
  const inset = 350

  const dx = Math.cos(yaw)
  const dz = Math.sin(yaw)

  // 이 방향으로 벽에 닿기까지의 거리
  const tx = Math.abs(dx) < 1e-4 ? Infinity : (room.w / 2 - inset) / Math.abs(dx)
  const tz = Math.abs(dz) < 1e-4 ? Infinity : (room.h / 2 - inset) / Math.abs(dz)
  const maxR = Math.max(600, Math.min(tx, tz))

  const r = maxR * Math.max(0.25, Math.min(1, zoom))
  const p = Math.max(0.05, Math.min(1.2, pitch))

  // 눈높이는 사람이 서 있는 범위 안에 묶습니다. 너무 높으면 도면처럼 보입니다.
  const eye = Math.max(700, Math.min(2100, 900 + Math.tan(p) * r))

  camera.position.set(cx + dx * r, eye, cz + dz * r)
  camera.lookAt(cx, 900, cz)
}

/** 방 하나를 볼 때의 기본 줌 (0~1, 1이면 벽에 최대한 붙습니다) */
export function defaultZoom(): number {
  return 0.92
}
