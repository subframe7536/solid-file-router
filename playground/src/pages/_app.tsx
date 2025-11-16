import { createRoute } from '../../../src/runtime'

export default createRoute({
  loadingComponent: () => <div>Loading...</div>,
  errorComponent: Catch,
  component: (props) => {
    return <div>{props.children}</div>
  },
})

function Catch(props: { error: Error; reset: () => void }) {
  console.error(props)
  return (
    <div>
      <code>{props.error.message}</code>
      <div>Caught at _app error boundary</div>
      <button onClick={() => props.reset}>reset</button>
    </div>
  )
}
