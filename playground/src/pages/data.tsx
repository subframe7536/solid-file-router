import { definePage } from 'solid-file-router'
import { onSettled } from 'solid-js'

function createInfo(name: string, usr: any): { name: string; role: any } {
  return { name, role: usr.role }
}

const preload = (): void => {
  console.log('preload1')
}
const user = { role: 'admin' }
const info = createInfo('test', user)

export const route = {
  info,
  preload,
  matchFilters: { name: ['Alice'] },
  errorComponent: (props: any) => {
    return <h1>{props.error.message}</h1>
  },
  loadingComponent: (props: any) => <div>Loading {props.location.hash}</div>,
}

export default definePage(() => {
  onSettled(() => {
    throw new Error('Test Error')
  })

  return <button>data</button>
})
