import { A } from '@solidjs/router'
import { createSignal, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

let previousStylesheet: HTMLLinkElement | undefined

export function HeadStylesheetStatus(props: { currentPage: string }): JSX.Element {
  const [status, setStatus] = createSignal('checking')

  onMount(() => {
    queueMicrotask(() => {
      const stylesheet = document.head.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')
      if (!stylesheet) {
        setStatus('missing')
        return
      }

      setStatus(previousStylesheet && previousStylesheet !== stylesheet ? 'recreated' : 'stable')
      previousStylesheet = stylesheet
    })
  })

  return (
    <section
      style={{
        'margin-top': '24px',
        padding: '16px',
        border: '1px solid #d8dee3',
        'border-radius': '8px',
        background: '#f8fafc',
        color: '#263238',
      }}
    >
      <strong>Head stylesheet stability</strong>
      <p data-testid="head-stylesheet-status">
        Main stylesheet node: <code>{status()}</code>
      </p>
      <p style={{ 'margin-bottom': '0' }}>
        Switch between <A href="/head-assets">page A</A> and <A href="/head-assets-next">page B</A>{' '}
        while watching this status.
      </p>
      <small>
        Current route: <code>{props.currentPage}</code>
      </small>
    </section>
  )
}
