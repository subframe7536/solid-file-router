import { createRoute } from 'solid-file-router'

export default createRoute({
  prerender: true,
  component: (props) => {
    return <div>{JSON.stringify(props)}</div>
  },
})
