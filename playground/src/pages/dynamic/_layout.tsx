import { createRoute } from 'solid-file-router'
import { isServer } from 'solid-js/web'

const renderTime = new Date().toISOString()

export default createRoute({
  component: (props) => {
    return (
      <div style={{ padding: '20px', 'font-family': 'system-ui, sans-serif' }}>
        <h2>Dynamic Layout</h2>
        <div
          style={{
            padding: '12px',
            background: '#f0f4ff',
            'border-radius': '8px',
            'margin-bottom': '20px',
            'font-size': '14px',
          }}
        >
          <div>
            <strong>Rendered at:</strong> {renderTime}
          </div>
          <div>
            <strong>isServer:</strong> {String(isServer)}
          </div>
          <div style={{ 'margin-top': '8px', color: '#666' }}>
            {isServer
              ? 'This HTML was rendered on the server. View page source to confirm.'
              : 'This content was rendered by client-side JavaScript (SPA).'}
          </div>
        </div>
        {props.children}
      </div>
    )
  },
})
