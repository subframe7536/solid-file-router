import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => {
    return (
      <div style={{ padding: '15px', background: '#f5f5f5', margin: '10px' }}>
        <h3>Route: No Inheritance</h3>
        <p>🚫 This route disables all inheritance</p>
        <ul style={{ 'text-align': 'left', 'font-size': '14px' }}>
          <li>Loading component: none (inherit: false)</li>
          <li>Error component: none (inherit: false)</li>
        </ul>
        <p style={{ 'font-size': '12px', color: '#666' }}>
          Uses <code>inherit: false</code> to opt-out completely
        </p>
      </div>
    )
  },
  inherit: false, // Disable all inheritance
})
