import { createComponent } from 'solid-js'
import { hydrate, render } from 'solid-js/web'
import type { JSX } from 'solid-js'

type MountableComponent = (props: Record<string, never>) => JSX.Element

export function mountApp(component: MountableComponent, elementId = 'app') {
  const element = document.getElementById(elementId)
  if (!element) {
    throw new Error(`Mount element with id "${elementId}" not found`)
  }

  const app = () => createComponent(component, {})
  if (element.hasChildNodes()) {
    return hydrate(app, element)
  }

  return render(app, element)
}
