import { onMount } from 'solid-js'
import { createRoute, generatePath } from '../../../src/runtime'
import { useNavigate } from '@solidjs/router'

export default createRoute({
  component: () => {
    const nav = useNavigate()
    onMount(() => {
      setTimeout(() => {
        nav(generatePath())
      }, 2000)
    })
    return <div>404</div>
  },
})
