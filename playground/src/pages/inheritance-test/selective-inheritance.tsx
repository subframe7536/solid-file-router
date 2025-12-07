import { createResource } from 'solid-js'
import { createRoute } from 'solid-file-router'
import { fetchMockData } from './utils'

export default createRoute({
  component: () => {
    const [data] = createResource(fetchMockData)

    return (
      <div style={{ padding: '15px', background: '#f5f5f5', margin: '10px' }}>
        <h3>Route: Selective Inheritance</h3>
        <p>⚙️ This route selectively disables error inheritance</p>
        <ul style={{ 'text-align': 'left', 'font-size': '14px' }}>
          <li>Loading component: from _layout.tsx (blue) - inherited</li>
          <li>Error component: none (inherit.error: false)</li>
          <li>Data: {data()}</li>
        </ul>
        <p style={{ 'font-size': '12px', color: '#666' }}>
          Uses <code>inherit: {'{ error: false }'}</code> for fine-grained control with 3s delay
        </p>
      </div>
    )
  },
  inherit: {
    loading: true, // Inherit loading component
    error: false, // Don't inherit error component
  },
})
