import './style.css'

import { FileRouter } from 'virtual:routes'

import { createClientEntry } from '../../src/runtime'

createClientEntry(() => <FileRouter />, document.getElementById('root')!)
