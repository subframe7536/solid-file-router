import './style.css'

import { render } from '@solidjs/web'
import { createFileRouter } from 'solid-file-router'

const Router = createFileRouter()

render(() => <Router>{(props) => <>{props.children}</>}</Router>, document.getElementById('root')!)
