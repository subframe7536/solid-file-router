import { useNavigate } from '@solidjs/router'
import { createRoute, generatePath } from 'solid-file-router'
import { onMount } from 'solid-js'

export default createRoute({
  component: () => {
    const nav = useNavigate()
    onMount(() => {
      setTimeout(() => {
        nav(generatePath('/nest/:id', { $id: 'from:404' }))
      }, 2000)
    })
    return <div>404</div>
  },
})
