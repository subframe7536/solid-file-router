import { A } from '@solidjs/router'
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => {
    return (
      <div>
        <h3>SSR vs SPA Demo</h3>
        <ul>
          <li>
            <strong>SSR (server):</strong> "Rendered at" shows the server-rendered timestamp,
            "isServer" is true in the page source. Content is visible before JS hydrates.
          </li>
          <li>
            <strong>SPA (client):</strong> "Rendered at" shows the current time, "isServer" is
            false. Content only appears after JS executes.
          </li>
        </ul>
        <p>
          <A href="/">Back to home</A>
        </p>
      </div>
    )
  },
})
