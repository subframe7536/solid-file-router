import type { Plugin } from 'vite'
import { ID_HELPER, VID_HELPER, VID_HELPER_RESOLVED } from './const'

const code = `
import { createComponent } from "solid-js/web";
import { ErrorBoundary, Suspense } from 'solid-js';

export default function (component, loadingComponent, errorComponent) {
  return (props) => {
    const Catch = errorComponent || (props => (import.meta.env.DEV && console.error(props.error), null))
    
    const child = loadingComponent
    ? createComponent(Suspense, {
        fallback: createComponent(loadingComponent, props),
        get children() {
          return createComponent(component, props);
        }
      })
    : createComponent(component, props)

    return createComponent(ErrorBoundary, {
      fallback: (error, reset) => createComponent(Catch, { error, reset }),
      get children() {
        return child
      }
    })
  }
}
`

export const helper: Plugin = {
  name: ID_HELPER,
  resolveId: {
    filter: {
      id: new RegExp(VID_HELPER),
    },
    handler() {
      return VID_HELPER_RESOLVED
    },
  },
  load: {
    filter: {
      id: new RegExp(VID_HELPER_RESOLVED),
    },
    handler() {
      return code
    },
  },
}
