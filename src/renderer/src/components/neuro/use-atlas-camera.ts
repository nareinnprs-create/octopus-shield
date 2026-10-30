import { useCallback, useEffect } from 'react'
import type { RefObject } from 'react'
import { hitTestNode, type AtlasSimNode } from './atlas-graph-layout'
import { NODE_RADIUS, type AtlasCamera } from './atlas-graph-canvas'

type UseAtlasCameraOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>
  cameraRef: RefObject<AtlasCamera>
  simNodesRef: RefObject<AtlasSimNode[]>
  onSelectNode: (id: string | null) => void
}

/** Wheel zoom around the cursor, drag pan, and click hit-testing for the atlas canvas. */
export function useAtlasCamera({
  canvasRef,
  cameraRef,
  simNodesRef,
  onSelectNode
}: UseAtlasCameraOptions): {
  toWorld: (clientX: number, clientY: number) => { x: number; y: number } | null
  centerOnNode: (id: string) => void
} {
  const toWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current
      if (!canvas) {
        return null
      }
      const rect = canvas.getBoundingClientRect()
      const camera = cameraRef.current
      return {
        x: (clientX - rect.left - rect.width / 2) / camera.scale + camera.x,
        y: (clientY - rect.top - rect.height / 2) / camera.scale + camera.y
      }
    },
    [canvasRef, cameraRef]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const camera = cameraRef.current
      const before = toWorld(event.clientX, event.clientY)
      const nextScale = Math.min(4, Math.max(0.1, camera.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))
      camera.scale = nextScale
      if (before) {
        const after = toWorld(event.clientX, event.clientY)
        if (after) {
          camera.x += before.x - after.x
          camera.y += before.y - after.y
        }
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [canvasRef, cameraRef, toWorld])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    let dragging: { clientX: number; clientY: number; moved: boolean } | null = null
    const onPointerDown = (event: PointerEvent): void => {
      dragging = { clientX: event.clientX, clientY: event.clientY, moved: false }
      canvas.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging) {
        return
      }
      const dx = event.clientX - dragging.clientX
      const dy = event.clientY - dragging.clientY
      if (!dragging.moved && Math.hypot(dx, dy) > 3) {
        dragging.moved = true
      }
      if (dragging.moved) {
        cameraRef.current.x -= dx / cameraRef.current.scale
        cameraRef.current.y -= dy / cameraRef.current.scale
        dragging.clientX = event.clientX
        dragging.clientY = event.clientY
      }
    }
    const onPointerUp = (event: PointerEvent): void => {
      const wasDrag = dragging?.moved ?? true
      dragging = null
      if (wasDrag) {
        return
      }
      const world = toWorld(event.clientX, event.clientY)
      if (!world) {
        return
      }
      const hit = hitTestNode(simNodesRef.current, world.x, world.y, NODE_RADIUS + 4)
      onSelectNode(hit?.id ?? null)
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
    }
  }, [canvasRef, cameraRef, simNodesRef, toWorld, onSelectNode])

  const centerOnNode = useCallback(
    (id: string): void => {
      const node = simNodesRef.current.find((candidate) => candidate.id === id)
      if (node) {
        cameraRef.current.x = node.x
        cameraRef.current.y = node.y
      }
    },
    [cameraRef, simNodesRef]
  )

  return { toWorld, centerOnNode }
}
