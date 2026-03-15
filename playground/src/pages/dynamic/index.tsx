import { A } from '@solidjs/router'
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => {
    return (
      <div>
        <h3>SSG vs SPA Demo</h3>
        <ul>
          <li>
            <strong>SSG (build):</strong> "Rendered at" shows the build timestamp, "isServer" is
            true in the page source. Content is visible before JS loads.
          </li>
          <li>
            <strong>SPA (dev):</strong> "Rendered at" shows the current time, "isServer" is false.
            Content only appears after JS executes.
          </li>
        </ul>
        <p>
          <A href="/">Back to home</A>
        </p>
      </div>
    )
  },
})
