import { createRoute } from 'solid-file-router'
import { createResource } from 'solid-js'

import { fetchMockData } from './utils'

export default createRoute({
  component: () => {
    const [data] = createResource(fetchMockData)

    return (
      <div style={{ padding: '15px', background: '#f5f5f5', margin: '10px' }}>
        <h3>Route: Custom Loading Component</h3>
        <p>✅ This route has its own loading component</p>
        <ul style={{ 'text-align': 'left', 'font-size': '14px' }}>
          <li>Loading component: custom (green) - overrides _layout.tsx</li>
          <li>Error component: from _app.tsx (inherited)</li>
          <li>Data: {data()}</li>
        </ul>
        <p style={{ 'font-size': '12px', color: '#666' }}>
          Demonstrates route-specific loading override with 3s delay
        </p>
      </div>
    )
  },
  loadingComponent: () => (
    <div
      style={{
        padding: '20px',
        background: '#e8f5e9',
        border: '2px dashed green',
        margin: '10px',
      }}
    >
      <div>🟢 Custom Loading Component</div>
      <div style={{ 'font-size': '12px', color: '#666' }}>
        (This is a route-specific loading component)
      </div>
    </div>
  ),
  // errorComponent not defined - will inherit from _app.tsx
})
