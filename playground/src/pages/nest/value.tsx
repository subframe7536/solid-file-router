import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => {
    return <div>{JSON.stringify(props)}</div>
  },
})
