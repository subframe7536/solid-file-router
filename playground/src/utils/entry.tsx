import { hydrate, render } from 'solid-js/web'
import type { JSX } from 'solid-js'

type RootComponent = () => JSX.Element

export function mountApp(component: RootComponent, elementId = 'app') {
  const element = document.getElementById(elementId)
  if (!element) {
    throw new Error(`Mount element with id "${elementId}" not found`)
  }

  const hasHydrationMarker = !!element.querySelector('[data-hk]')
  if (hasHydrationMarker) {
    return hydrate(component, element)
  }

  return render(component, element)
}
