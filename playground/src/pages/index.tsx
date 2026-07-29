import { A } from '@solidjs/router'
import { createRoute } from 'solid-file-router'

import { TestComponent } from '../components/test'

export default createRoute({
  component: () => {
    return (
      <div style={{ padding: '20px', 'font-family': 'system-ui, sans-serif' }}>
        <h1>Solid File Router Playground</h1>
        <p>Test and explore file-based routing features</p>
        <input type="text" />
        <TestComponent />

        <nav style={{ 'margin-top': '30px' }}>
          <h2>Available Routes:</h2>
          <ul style={{ 'list-style': 'none', padding: 0 }}>
            <li style={{ 'margin-bottom': '15px' }}>
              <A
                href="/mdx"
                style={{
                  display: 'block',
                  padding: '15px',
                  background: '#fff4e5',
                  'border-radius': '8px',
                  'text-decoration': 'none',
                  color: '#9a4d00',
                }}
              >
                <strong>MDX Custom Route</strong>
                <div style={{ 'font-size': '14px', color: '#666', 'margin-top': '5px' }}>
                  Compile MDX with Satteri through a custom route source
                </div>
              </A>
            </li>

            <li style={{ 'margin-bottom': '15px' }}>
              <A
                href="/data"
                style={{
                  display: 'block',
                  padding: '15px',
                  background: '#f5f5f5',
                  'border-radius': '8px',
                  'text-decoration': 'none',
                  color: '#333',
                }}
              >
                <strong>Data Route</strong>
                <div style={{ 'font-size': '14px', color: '#666', 'margin-top': '5px' }}>
                  Test error handling and custom components
                </div>
              </A>
            </li>

            <li style={{ 'margin-bottom': '15px' }}>
              <A
                href="/inheritance-test"
                style={{
                  display: 'block',
                  padding: '15px',
                  background: '#e3f2fd',
                  'border-radius': '8px',
                  'text-decoration': 'none',
                  color: '#1976d2',
                }}
              >
                <strong>Component Inheritance Test Suite</strong>
                <div style={{ 'font-size': '14px', color: '#666', 'margin-top': '5px' }}>
                  Explore how routes inherit loading and error components from layouts
                </div>
              </A>
            </li>

            <li style={{ 'margin-bottom': '15px' }}>
              <A
                href="/nest/value?date=1#1"
                style={{
                  display: 'block',
                  padding: '15px',
                  background: '#f5f5f5',
                  'border-radius': '8px',
                  'text-decoration': 'none',
                  color: '#333',
                }}
              >
                <strong>Nested Routes</strong>
                <div style={{ 'font-size': '14px', color: '#666', 'margin-top': '5px' }}>
                  Test nested routing structure
                </div>
              </A>
            </li>

            <li style={{ 'margin-bottom': '15px' }}>
              <A
                href="/dynamic"
                style={{
                  display: 'block',
                  padding: '15px',
                  background: '#e8f5e9',
                  'border-radius': '8px',
                  'text-decoration': 'none',
                  color: '#2e7d32',
                }}
              >
                <strong>SSR vs SPA Demo</strong>
                <div style={{ 'font-size': '14px', color: '#666', 'margin-top': '5px' }}>
                  See how the same layout renders differently in SSR and SPA modes
                </div>
              </A>
            </li>
          </ul>
        </nav>
      </div>
    )
  },
})
