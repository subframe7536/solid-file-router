import { createComponent } from 'solid-js'
import { hydrate, render } from 'solid-js/web'
import type { JSX } from 'solid-js'

type AppComponent = (props: Record<string, never>) => JSX.Element

export function mountRouter(component: AppComponent, elementId = 'app') {
  const element = document.getElementById(elementId)
  if (!element) {
    throw new Error(`Mount element "#${elementId}" not found`)
  }

  const app = () => createComponent(component, {})
  if (element.hasChildNodes()) {
    return hydrate(app, element)
  }

  return render(app, element)
}
