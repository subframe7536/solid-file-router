import { createRoute } from '../../../../src/runtime'

export default createRoute({
  component: (props) => {
    return <div>{JSON.stringify(props)}</div>
  },
})
