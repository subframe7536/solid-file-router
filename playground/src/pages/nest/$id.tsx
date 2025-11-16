import { createRoute } from '../../../../src/runtime'

export default createRoute<{ id: string }>({
  component: (props) => {
    return <div>{props.data.id}</div>
  },
})
