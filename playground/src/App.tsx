import { Router } from './router'

export default function App(): any {
  return <Router>{(props: any) => <>{props.children}</>}</Router>
}
