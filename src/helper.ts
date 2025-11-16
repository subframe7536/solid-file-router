import type { Plugin } from 'vite'
import { ID_HELPER, VID_HELPER, VID_HELPER_RESOLVED } from './const'

const code = `
import { createComponent } from "solid-js/web";
import { ErrorBoundary, Show, Suspense } from 'solid-js';

export default function (config) {
  return (props) => {
    const load = config.loadingComponent ? createComponent(config.loadingComponent, props) : null;
    const Catch = config.errorComponent || (props => (import.meta.env.DEV && console.error(props), null));
    const comp = createComponent(ErrorBoundary, {
      fallback: (error, reset) => createComponent(Catch, { error, reset }),
      get children() {
        return createComponent(config.component, props);
      }
    });
    return createComponent(Show, {
      when: load,
      fallback: comp,
      get children() {
        return createComponent(Suspense, {
          fallback: load,
          children: comp
        });
      }
    });
  };
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
