import { useNavigate } from '@solidjs/router'
import { onSettled } from 'solid-js'

import { Router } from '../router'

export default function NotFound(): any {
  const nav = useNavigate()
  onSettled(() => {
    setTimeout(() => {
      nav(Router.paths.nest('from:404'))
    }, 2000)
  })
  return <div>404</div>
}
