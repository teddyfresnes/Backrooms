import { useRef, type PointerEvent } from 'react'

interface Props {
  title: string
  x: number
  y: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  xStart: string
  xEnd: string
  yStart: string
  yEnd: string
  onBegin: () => void
  onChange: (x: number, y: number) => void
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const inverseLerp = (min: number, max: number, value: number) => max === min ? 0.5 : clamp((value - min) / (max - min))
const lerp = (min: number, max: number, t: number) => min + (max - min) * t

export function MorphPad({ title, x, y, xMin, xMax, yMin, yMax, xStart, xEnd, yStart, yEnd, onBegin, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const update = (event: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const px = clamp((event.clientX - rect.left) / rect.width)
    const py = clamp((event.clientY - rect.top) / rect.height)
    onChange(lerp(xMin, xMax, px), lerp(yMax, yMin, py))
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    onBegin()
    event.currentTarget.setPointerCapture(event.pointerId)
    update(event)
  }

  return <div className="morph-pad-wrap">
    <strong>{title}</strong>
    <div className="morph-pad-y-label top">{yEnd}</div>
    <div
      ref={ref}
      className="morph-pad"
      onPointerDown={onPointerDown}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) update(event) }}
      role="slider"
      aria-label={title}
      tabIndex={0}
    >
      <span className="morph-pad-dot" style={{ left: `${inverseLerp(xMin, xMax, x) * 100}%`, top: `${(1 - inverseLerp(yMin, yMax, y)) * 100}%` }} />
    </div>
    <div className="morph-pad-axis x"><span>{xStart}</span><span>{xEnd}</span></div>
    <div className="morph-pad-y-label bottom">{yStart}</div>
  </div>
}
