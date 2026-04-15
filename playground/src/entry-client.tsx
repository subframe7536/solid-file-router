import './style.css'

import { renderClient } from 'solid-file-router'
import { FileRouter } from 'virtual:routes'

renderClient(() => <FileRouter />, 'app')
