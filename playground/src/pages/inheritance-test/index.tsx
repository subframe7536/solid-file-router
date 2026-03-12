import { A } from '@solidjs/router'
import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => {
    return (
      <div style={{ padding: '15px', background: '#fff3e0', margin: '10px' }}>
        <h3>Component Inheritance Test Suite</h3>
        <p>
          This section demonstrates how routes inherit loading and error components from layouts.
        </p>

        <div style={{ 'margin-top': '20px' }}>
          <h4>Test Routes:</h4>
          <nav
            style={{
              display: 'flex',
              'flex-direction': 'column',
              gap: '10px',
              'margin-top': '10px',
            }}
          >
            <A
              href="/inheritance-test/default"
              style={{
                padding: '10px',
                background: '#e3f2fd',
                'border-radius': '4px',
                'text-decoration': 'none',
                color: '#1976d2',
              }}
            >
              1. Default Inheritance
              <div style={{ 'font-size': '12px', color: '#666' }}>
                Inherits loading from layout, error from app
              </div>
            </A>

            <A
              href="/inheritance-test/custom-loading"
              style={{
                padding: '10px',
                background: '#e8f5e9',
                'border-radius': '4px',
                'text-decoration': 'none',
                color: '#388e3c',
              }}
            >
              2. Custom Loading Component
              <div style={{ 'font-size': '12px', color: '#666' }}>
                Overrides layout loading, inherits app error
              </div>
            </A>

            <A
              href="/inheritance-test/no-inheritance"
              style={{
                padding: '10px',
                background: '#ffebee',
                'border-radius': '4px',
                'text-decoration': 'none',
                color: '#d32f2f',
              }}
            >
              3. No Inheritance (inherit: false)
              <div style={{ 'font-size': '12px', color: '#666' }}>
                Completely opts out of inheritance
              </div>
            </A>

            <A
              href="/inheritance-test/selective-inheritance"
              style={{
                padding: '10px',
                background: '#f3e5f5',
                'border-radius': '4px',
                'text-decoration': 'none',
                color: '#7b1fa2',
              }}
            >
              4. Selective Inheritance
              <div style={{ 'font-size': '12px', color: '#666' }}>
                Inherits loading only, disables error inheritance
              </div>
            </A>
          </nav>
        </div>

        <div style={{ 'margin-top': '20px', 'font-size': '14px', color: '#666' }}>
          <h4>Inheritance Chain:</h4>
          <ol>
            <li>Route-specific component (highest priority)</li>
            <li>Layout component (_layout.tsx)</li>
            <li>App component (_app.tsx)</li>
            <li>None (lowest priority)</li>
          </ol>
        </div>
      </div>
    )
  },
})
