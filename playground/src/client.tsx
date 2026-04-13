import './style.css'

import { FileRouter } from 'virtual:routes'
import { mountRouterApp } from 'virtual:solid-file-router-client-entry'

mountRouterApp(() => <FileRouter />)
