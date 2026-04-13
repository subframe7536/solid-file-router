import { hydrate, render } from 'solid-js/web'
import type { JSX } from 'solid-js'

type RootComponent = () => JSX.Element
const SOLID_HYDRATION_MARKER = 'data-hk'

export function mountApp(component: RootComponent, elementId = 'app') {
  const element = document.getElementById(elementId)
  if (!element) {
    throw new Error(`Mount element with id "${elementId}" not found`)
  }

  const hasHydrationMarker = !!element.querySelector(`[${SOLID_HYDRATION_MARKER}]`)
  if (hasHydrationMarker) {
    return hydrate(component, element)
  }

  return render(component, element)
}
