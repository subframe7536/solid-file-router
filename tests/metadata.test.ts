// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { RouteMetadataManager } from '../src/metadata'

const BASELINE = {
  title: '<title>Default title</title>',
  meta: {
    'name:description': ['<meta name="description" content="Default description">'],
    'name:viewport': ['<meta name="viewport" content="width=device-width" />'],
  },
  links: {
    'rel:stylesheet': ['<link rel="stylesheet" crossorigin href="/assets/index.css">'],
    'rel:icon': ['<link rel="icon" href="/favicon.svg">'],
    'rel:preload': ['<link rel="preload" href="/fonts/docs.woff2" as="font" crossorigin>'],
    'rel:modulepreload': ['<link rel="modulepreload" href="/assets/route.js">'],
    'rel:canonical': ['<link rel="canonical" href="/">'],
    'rel:alternate': ['<link rel="alternate" href="/?format=html">'],
  },
}

function setHead(): void {
  document.head.innerHTML = `
    <title>Page title</title>
    <meta name="description" content="Page description">
    <meta name="viewport" content="custom viewport">
    <link rel="stylesheet" crossorigin href="/assets/index.css">
    <link rel="icon" href="/favicon.svg">
    <link rel="preload" href="/fonts/docs.woff2" as="font" crossorigin>
    <link rel="modulepreload" href="/assets/route.js">
    <link rel="canonical" href="/page">
    <link rel="alternate" href="/page?format=html">
    <script type="application/json" data-solid-file-router-head-default>${JSON.stringify(BASELINE)}</script>
  `
}

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('RouteMetadataManager', () => {
  it('does not rebuild asset links while route metadata changes', () => {
    setHead()
    const manager = new RouteMetadataManager(document)
    manager.apply({
      title: 'Page title',
      description: 'Page description',
      canonical: '/page',
      meta: [{ name: 'viewport', content: 'custom viewport' }],
      links: [{ rel: 'alternate', href: '/page?format=html' }],
    })

    const stylesheet = document.head.querySelector('link[rel="stylesheet"]')!
    const icon = document.head.querySelector('link[rel="icon"]')!
    const preload = document.head.querySelector('link[rel="preload"]')!
    const modulepreload = document.head.querySelector('link[rel="modulepreload"]')!
    const dynamicStylesheet = document.createElement('link')
    dynamicStylesheet.rel = 'stylesheet'
    dynamicStylesheet.href = '/assets/route.css'
    document.head.append(dynamicStylesheet)

    manager.apply(undefined)

    expect(document.head.querySelector('link[rel="stylesheet"]')).toBe(stylesheet)
    expect(document.head.querySelector('link[rel="icon"]')).toBe(icon)
    expect(document.head.querySelector('link[rel="preload"]')).toBe(preload)
    expect(document.head.querySelector('link[rel="modulepreload"]')).toBe(modulepreload)
    expect(document.head.querySelector('link[href="/assets/route.css"]')).toBe(dynamicStylesheet)
    expect(document.title).toBe('Default title')
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Default description',
    )
    expect(document.head.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe(
      'width=device-width',
    )
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('/')
    expect(document.head.querySelector('link[rel="alternate"]')?.getAttribute('href')).toBe(
      '/?format=html',
    )

    const restoredViewport = document.head.querySelector('meta[name="viewport"]')!
    manager.apply({ title: 'Another page' })

    expect(document.head.querySelector('meta[name="viewport"]')).toBe(restoredViewport)
  })
})
