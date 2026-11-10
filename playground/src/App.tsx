import { announceRoutes } from 'solid-file-router'

import { Router } from './router'

export default function App(): any {
  announceRoutes()
  return <Router>{(props: any) => <>{props.children}</>}</Router>
}
