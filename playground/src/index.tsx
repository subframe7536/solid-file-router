import './style.css'

import { render } from '@solidjs/web'
import { createFileRouter } from 'solid-file-router'

const Router = createFileRouter()

const root = document.getElementById('root')
if (root) {
  render(() => <Router>{(props) => <>{props.children}</>}</Router>, root)
}
