import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { FloorPlan, PlacedItem } from '../lib/plan/types'
import type { DesignStyle, Product } from '../types'
import { buildScene, defaultZoom, orbitInside } from '../lib/plan/scene3d'
import { Button } from './ui/primitives'

/**
 * 3D 뷰.
 *
 * 평면 편집기와 **같은 데이터**를 봅니다. 3D 전용 상태를 따로 두면 평면에서 옮긴
 * 소파가 3D 에서는 그대로인 상태가 반드시 생깁니다.
 *
 * 조작: 드래그로 궤도 회전, 휠로 확대, 가구를 누르면 선택.
 */
export function Room3D({
  plan,
  items,
  style,
  productBySku,
  selected,
  onSelect,
}: {
  plan: FloorPlan
  items: PlacedItem[]
  style: DesignStyle
  productBySku: (sku: string) => Product | undefined
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const handles = useRef<ReturnType<typeof buildScene> | null>(null)
  const [roomId, setRoomId] = useState<string>(
    () => (plan.rooms.find((r) => r.kind === 'living') ?? plan.rooms[0]).id,
  )
    // zoom 은 0~1 로, 방 벽까지 남은 거리의 비율입니다(고정 거리는 방 크기에 따라 벽을 뚫습니다).
  const cam = useRef({ yaw: -Math.PI / 2.6, pitch: 0.3, zoom: defaultZoom() })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [ready, setReady] = useState(false)

  /*
   * 씬은 평면이나 배치가 바뀔 때만 다시 만듭니다.
   * 카메라 조작마다 재생성하면 매 프레임 지오메트리를 새로 올리게 됩니다.
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let h: ReturnType<typeof buildScene>
    try {
      h = buildScene({ plan, items, style, productBySku, canvas })
    } catch {
      // WebGL 을 못 쓰는 환경도 있습니다. 그때는 평면 편집기만 쓰면 됩니다.
      setReady(false)
      return
    }
    handles.current = h
    setReady(true)


    let raf = 0
    const render = () => {
      const el = wrapRef.current
      if (el) {
        const w = el.clientWidth
        const ht = el.clientHeight
        if (canvas.width !== w || canvas.height !== ht) {
          h.renderer.setSize(w, ht, false)
          h.camera.aspect = w / Math.max(1, ht)
          h.camera.updateProjectionMatrix()
        }
      }
      const r = plan.rooms.find((x) => x.id === roomId) ?? plan.rooms[0]
      orbitInside(h.camera, r, cam.current.yaw, cam.current.pitch, cam.current.zoom)
      h.renderer.render(h.scene, h.camera)
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(raf)
      h.dispose()
      handles.current = null
    }
  }, [plan, items, style, productBySku, roomId])

  /** 선택된 가구를 밝게 표시합니다. */
  useEffect(() => {
    const h = handles.current
    if (!h) return
    for (const obj of h.pickable) {
      const mesh = obj as THREE.Mesh
      const mat = mesh.material as THREE.MeshStandardMaterial
      const on = mesh.userData.itemId === selected
      mat.emissive = new THREE.Color(on ? 0x2f6f4f : 0x000000)
      mat.emissiveIntensity = on ? 0.6 : 0
    }
  }, [selected, ready, items])

  const pick = (clientX: number, clientY: number) => {
    const h = handles.current
    const canvas = canvasRef.current
    if (!h || !canvas) return
    const r = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, h.camera)
    const hit = ray.intersectObjects(h.pickable, false)[0]
    onSelect(hit ? (hit.object.userData.itemId as string) : null)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          className="rounded-lg border border-line bg-ink-900 px-2 py-2 text-xs text-mist-200 outline-none"
        >
          {plan.rooms
            .filter((r) => r.kind !== 'balcony')
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} 시점
              </option>
            ))}
        </select>
        <Button size="sm" variant="chip" onClick={() => (cam.current.yaw -= Math.PI / 6)}>
          ↺ 왼쪽
        </Button>
        <Button size="sm" variant="chip" onClick={() => (cam.current.yaw += Math.PI / 6)}>
          ↻ 오른쪽
        </Button>
        <span className="text-xs text-mist-500">드래그로 회전 · 휠로 확대 · 가구를 누르면 선택</span>
      </div>

      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-xl border border-line-soft bg-ink-850"
        style={{ aspectRatio: '16 / 10' }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const dx = e.clientX - drag.current.x
          const dy = e.clientY - drag.current.y
          cam.current.yaw += dx * 0.006
          cam.current.pitch += dy * 0.005
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const started = drag.current
          drag.current = null
          // 끌지 않고 눌렀다 뗀 것만 선택으로 봅니다.
          if (started && Math.abs(e.clientX - started.x) < 4 && Math.abs(e.clientY - started.y) < 4) {
            pick(e.clientX, e.clientY)
          }
        }}
        onPointerLeave={() => {
          drag.current = null
        }}
        onWheel={(e) => {
          cam.current.zoom = Math.max(0.25, Math.min(1, cam.current.zoom * (1 + e.deltaY * 0.0012)))
        }}
      >
        <canvas ref={canvasRef} className="block h-full w-full touch-none" />
        {!ready ? (
          <p className="absolute inset-0 grid place-items-center p-6 text-center text-xs text-mist-400">
            이 브라우저에서 3D(WebGL)를 쓸 수 없습니다. 평면 배치는 그대로 사용할 수 있습니다.
          </p>
        ) : null}
      </div>

      <p className="text-xs text-mist-500">
        평면 배치와 같은 데이터를 봅니다 — 평면에서 옮기면 여기도 함께 바뀝니다. 가구는 실제 형태가 아니라
        <b> 치수가 맞는 덩어리</b>로 표시합니다. 부피와 동선을 가늠하는 용도이며, 형태를 어설프게 흉내 내면
        실제 제품으로 오인하게 됩니다.
      </p>
    </div>
  )
}
