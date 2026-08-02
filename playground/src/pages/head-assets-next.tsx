import { createRoute } from 'solid-file-router'

import { HeadStylesheetStatus } from '../components/head-stylesheet-status'

export default createRoute({
  metadata: {
    title: 'Head Assets B | Solid File Router',
    description: 'Metadata page B for testing stylesheet stability during SPA navigation.',
    canonical: '/head-assets-next',
  },
  component: () => (
    <main style={{ padding: '20px', 'font-family': 'system-ui, sans-serif' }}>
      <h1>Head Assets B</h1>
      <p>This route changes metadata without changing the shared stylesheet node.</p>
      <HeadStylesheetStatus currentPage="B" />
    </main>
  ),
})
