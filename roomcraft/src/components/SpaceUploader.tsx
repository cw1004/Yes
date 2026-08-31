import { useRef, useState } from 'react'
import { useStudio } from '../store/useStudio'
import { spaceById } from '../data/spaces'
import { generateSampleRoom } from '../lib/sampleRoom'
import { Button, Card, SectionTitle, inputClass } from './ui/primitives'

const MAX_BYTES = 12 * 1024 * 1024

export function SpaceUploader() {
  const { sourceImage, sourceName, spaceId, projectName, setSource, setProjectName, showToast } =
    useStudio()
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const accept = (file: File) => {
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 업로드할 수 있습니다.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('파일이 너무 큽니다. 12MB 이하 이미지를 사용해 주세요.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setSource(String(reader.result), file.name)
      showToast('공간 사진을 불러왔습니다. 스타일을 선택하고 메이크오버를 생성하세요.')
    }
    reader.onerror = () => setError('파일을 읽지 못했습니다.')
    reader.readAsDataURL(file)
  }

  return (
    <Card className="p-4">
      <SectionTitle
        icon="①"
        title="공간 사진 업로드"
        desc="정면에서 찍은 밝은 사진일수록 결과가 좋습니다. (JPG/PNG, 12MB 이하)"
        right={
          <Button
            size="sm"
            variant="chip"
            onClick={() => {
              const url = generateSampleRoom(spaceId)
              if (url) {
                setSource(url, `sample-${spaceId}.jpg`)
                showToast('샘플 이미지를 불러왔습니다.')
              }
            }}
          >
            샘플 이미지 사용
          </Button>
        }
      />

      <div className="mt-4 grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files?.[0]
            if (file) accept(file)
          }}
          onClick={() => inputRef.current?.click()}
          className={`grid min-h-[168px] cursor-pointer place-items-center rounded-xl border-2 border-dashed p-6 text-center transition ${
            dragging ? 'border-amber-brand bg-amber-brand/8' : 'border-line bg-ink-900 hover:border-line-strong'
          }`}
        >
          {sourceImage ? (
            <div className="flex w-full items-center gap-4">
              <img
                src={sourceImage}
                alt="업로드한 공간"
                className="h-24 w-32 shrink-0 rounded-lg object-cover"
              />
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-semibold text-mist-200">{sourceName}</p>
                <p className="mt-1 text-xs text-mist-400">{spaceById(spaceId).label}으로 분석됩니다.</p>
                <p className="mt-2 text-xs text-amber-brand">클릭하여 다른 사진으로 교체</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-3xl">🖼</div>
              <p className="mt-2 text-sm font-semibold text-mist-200">사진을 드래그하거나 클릭해서 업로드</p>
              <p className="mt-1 text-xs text-mist-400">
                업로드한 이미지는 브라우저 안에서만 처리되며, 서버 렌더 시에만 전송됩니다.
              </p>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) accept(file)
              e.target.value = ''
            }}
          />
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-mist-400">프로젝트 이름</span>
            <input
              className={inputClass}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="예: 성수동 32평 아파트 거실"
            />
          </label>
          <ul className="space-y-1.5 text-xs text-mist-400">
            <li>· 가구가 적고 벽이 보이는 사진일수록 리모델링 폭이 큽니다.</li>
            <li>· 광각 왜곡이 심하면 원근이 어긋날 수 있습니다.</li>
            <li>· 인물이 포함된 사진은 자동으로 제외 처리됩니다.</li>
          </ul>
        </div>
      </div>

      {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
    </Card>
  )
}
