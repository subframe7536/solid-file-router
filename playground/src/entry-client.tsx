import './style.css'

import { renderClient } from 'virtual:router-entry'
import { FileRouter } from 'virtual:routes'

renderClient(() => <FileRouter />)
