import { createRoute } from 'solid-file-router'
import { onMount } from 'solid-js'

function createInfo(name: string, usr: any) {
  return { name, role: usr.role }
}

const preload = () => {
  console.log('preload1')
}
const user = { role: 'admin' }
const info = createInfo('test', user)

export default createRoute({
  info,
  preload,
  matchFilters: { name: ['Alice'] },
  errorComponent: (props) => {
    return <h1>{props.error.message}</h1>
  },
  loadingComponent: (props) => <div>Loading {props.location.hash}</div>,
  component: () => {
    onMount(() => {
      throw new Error('Test Error')
    })

    return <button>data</button>
  },
})
