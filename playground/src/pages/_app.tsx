import { createRoute } from 'solid-file-router'
import { MDXProvider } from 'solid-file-router/mdx'
import type { JSX } from 'solid-js'

export default createRoute({
  loadingComponent: () => <div>Loading...</div>,
  errorComponent: Catch,
  component: (props) => {
    return (
      <MDXProvider>
        <div>{props.children}</div>
      </MDXProvider>
    )
  },
})

function Catch(props: { error: Error; reset: () => void }): JSX.Element {
  console.error(props)
  return (
    <div>
      <code>{props.error.message}</code>
      <div>Caught at _app error boundary</div>
      <button onClick={() => props.reset}>reset</button>
    </div>
  )
}
