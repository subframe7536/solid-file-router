import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => {
    return (
      <div style={{ padding: '20px', border: '2px solid blue', margin: '10px' }}>
        <h2>Layout: Inheritance Test Section</h2>
        <p style={{ color: 'blue', 'font-size': '12px' }}>
          This layout provides a custom loading component
        </p>
        <div>{props.children}</div>
      </div>
    )
  },
  loadingComponent: () => (
    <div
      style={{
        padding: '20px',
        background: '#e3f2fd',
        border: '2px dashed blue',
        margin: '10px',
      }}
    >
      <div>🔵 Loading from _layout.tsx...</div>
      <div style={{ 'font-size': '12px', color: '#666' }}>
        (This is the layout-level loading component)
      </div>
    </div>
  ),
  // errorComponent not defined - will inherit from _app.tsx
})
