import { createComponent } from 'solid-js'
import { generateHydrationScript, renderToStringAsync } from 'solid-js/web'
import { FileRouter, fileRoutes } from 'virtual:routes'

export { fileRoutes }

export async function render(url: string) {
  let renderError: unknown
  const html = await renderToStringAsync(() => {
    try {
      return createComponent(FileRouter, { url })
    } catch (e) {
      renderError = e
      return '' as unknown as ReturnType<typeof FileRouter>
    }
  })
  if (renderError) {
    throw renderError
  }
  return { html, head: generateHydrationScript() }
}
