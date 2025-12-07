import { createResource } from 'solid-js'
import { createRoute } from 'solid-file-router'
import { fetchMockData } from './utils'

export default createRoute({
  component: () => {
    const [data] = createResource(fetchMockData)

    return (
      <div style={{ padding: '15px', background: '#f5f5f5', margin: '10px' }}>
        <h3>Route: Default Inheritance</h3>
        <p>✅ This route inherits both loading and error components from ancestors</p>
        <ul style={{ 'text-align': 'left', 'font-size': '14px' }}>
          <li>Loading component: from _layout.tsx (blue)</li>
          <li>Error component: from _app.tsx</li>
          <li>Data: {data()}</li>
        </ul>
        <p style={{ 'font-size': '12px', color: '#666' }}>
          No custom components defined, uses full inheritance chain with 3s delay
        </p>
      </div>
    )
  },
  // No loadingComponent or errorComponent defined
  // Will inherit: loading from _layout.tsx, error from _app.tsx
})
