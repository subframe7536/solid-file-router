import type { RouteSectionProps } from '@solidjs/router'
import type { ErrorComponentProps } from 'solid-file-router'
import { definePage } from 'solid-file-router'
import { onSettled } from 'solid-js'

function createInfo(name: string, usr: { role: string }): { name: string; role: string } {
  return { name, role: usr.role }
}

const preload = (): void => {
  console.warn('preload1')
}
const user = { role: 'admin' }
const info = createInfo('test', user)

export const route = {
  info,
  preload,
  matchFilters: { name: ['Alice'] },
  errorComponent: (props: ErrorComponentProps) => {
    const message = props.error instanceof Error ? props.error.message : String(props.error)
    return <h1>{message}</h1>
  },
  loadingComponent: (props: RouteSectionProps) => <div>Loading {props.location.hash}</div>,
}

export default definePage(() => {
  onSettled(() => {
    throw new Error('Test Error')
  })

  return <button>data</button>
})
