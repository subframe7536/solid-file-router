import { createRoute } from 'solid-file-router'

export default createRoute({
  preload: () => {
    return 123
  },
  component: (props) => {
    return <div>data: {JSON.stringify(props.data)}</div>
  },
})
