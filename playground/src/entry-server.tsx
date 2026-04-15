import { renderServer } from 'solid-file-router'
import { FileRouter } from 'virtual:routes'

export default renderServer(() => <FileRouter />, {
  onRenderError({ error }) {
    throw error
  },
  extraHead(context) {
    return `<meta name="x-route" content="${context.url}" />`
  },
})
