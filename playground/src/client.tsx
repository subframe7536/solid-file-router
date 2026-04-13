import './style.css'

import { createComponent } from 'solid-js'
import { FileRouter } from 'virtual:routes'

import { mountApp } from './utils/entry'

mountApp(() => createComponent(FileRouter, {}))
