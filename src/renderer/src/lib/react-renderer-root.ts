import { createRoot, type Root } from 'react-dom/client'

type RendererRootHotData = {
  shieldRendererRoot?: Root
}

export function getOrCreateRendererRoot(
  container: HTMLElement,
  hotData?: RendererRootHotData
): Root {
  const existingRoot = hotData?.shieldRendererRoot
  if (existingRoot) {
    return existingRoot
  }
  const root = createRoot(container)
  if (hotData) {
    hotData.shieldRendererRoot = root
  }
  return root
}
