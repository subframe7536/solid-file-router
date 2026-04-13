import { renderServer } from 'virtual:router-entry'

export default async function render(url: string) {
  return renderServer({
    url,
    onRenderError(error) {
      throw error
    },
    extraHead(context) {
      return `<meta name="x-route" content="${context.url}" />`
    },
  })
}
