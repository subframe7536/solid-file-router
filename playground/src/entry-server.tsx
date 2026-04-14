import { renderServer } from 'virtual:router-entry'

export default renderServer({
  onRenderError(error) {
    throw error
  },
  extraHead(context) {
    return `<meta name="x-route" content="${context.url}" />`
  },
})
