import { onMount } from 'solid-js'
import { createRoute, generatePath } from 'solid-file-router'
import { useNavigate } from '@solidjs/router'

export default createRoute({
  component: () => {
    const nav = useNavigate()
    onMount(() => {
      setTimeout(() => {
        nav(generatePath('/nest/:id', { $id: '1' }))
      }, 2000)
    })
    return <div>404</div>
  },
})
