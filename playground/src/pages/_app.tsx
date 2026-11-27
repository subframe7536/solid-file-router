import type { JSX } from '@solidjs/web'
import { definePage } from 'solid-file-router'
import { MDXProvider } from 'solid-file-router/mdx'

export const route = {
  loadingComponent: () => <div>Loading...</div>,
  errorComponent: Catch,
}

export default definePage((props) => {
  return (
    <MDXProvider>
      <div>{props.children}</div>
    </MDXProvider>
  )
})

function Catch(props: { error: unknown; reset: () => void }): JSX.Element {
  console.error(props)
  const message = props.error instanceof Error ? props.error.message : String(props.error)
  return (
    <div>
      <code>{message}</code>
      <div>Caught at _app error boundary</div>
      <button onClick={() => props.reset()}>reset</button>
    </div>
  )
}
