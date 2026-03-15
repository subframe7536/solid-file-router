import './style.css'

import { hydrate } from 'solid-js/web'
import { FileRouter } from 'virtual:routes'

hydrate(() => <FileRouter />, document.getElementById('app')!)
