import './style.css'

import { render } from 'solid-js/web'

import { FileRouter } from 'virtual:routes'

render(() => <FileRouter />, document.getElementById('app')!)
