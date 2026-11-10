import { HeadStylesheetStatus } from '../components/head-stylesheet-status'

export const route = {
  metadata: {
    title: 'Head Assets A | Solid File Router',
    description: 'Metadata page A for testing stylesheet stability during SPA navigation.',
    canonical: '/head-assets',
  },
}

export default (): any => (
  <main style={{ padding: '20px', 'font-family': 'system-ui, sans-serif' }}>
    <h1>Head Assets A</h1>
    <p>This route supplies metadata while the shared stylesheet remains loaded.</p>
    <HeadStylesheetStatus currentPage="A" />
  </main>
)
