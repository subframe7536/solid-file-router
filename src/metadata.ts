import type { RouteMatch, RouteSectionProps } from '@solidjs/router'
import { createComponent, createEffect, onCleanup } from 'solid-js'
import type { Component } from 'solid-js'

/** Metadata attached to a route and applied during SSG and client navigation. */
export interface RouteMetadata {
  title?: string
  description?: string
  canonical?: string
  meta?: Array<RouteMetaTag>
  links?: Array<RouteMetadataLink>
}

export interface RouteMetaTag {
  name?: string
  property?: string
  content: string
}

export interface RouteMetadataLink {
  rel: string
  href: string
}

type CurrentMatches = () => readonly RouteMatch[]

interface MetadataBaseline {
  title: string | null
  meta: Record<string, string[]>
  links: Record<string, string[]>
}

const BASELINE_SELECTOR = 'script[data-solid-file-router-head-default]'

function getMetaIdentity(element: Element): string | undefined {
  const name = element.getAttribute('name')
  if (name !== null) {
    return `name:${name}`
  }
  const property = element.getAttribute('property')
  return property === null ? undefined : `property:${property}`
}

function getLinkIdentity(element: Element): string | undefined {
  const rel = element.getAttribute('rel')
  return rel === null ? undefined : `rel:${rel}`
}

function collectBaseline(document: Document): MetadataBaseline {
  const baselineScript = document.head.querySelector<HTMLScriptElement>(BASELINE_SELECTOR)
  if (baselineScript) {
    try {
      const parsed = JSON.parse(baselineScript.textContent ?? '') as Partial<MetadataBaseline>
      baselineScript.remove()
      return {
        title: typeof parsed.title === 'string' ? parsed.title : null,
        meta: parsed.meta ?? {},
        links: parsed.links ?? {},
      }
    } catch {
      baselineScript.remove()
    }
  }

  const meta: Record<string, string[]> = {}
  for (const element of document.head.querySelectorAll('meta')) {
    const identity = getMetaIdentity(element)
    if (identity) {
      const tags = meta[identity] ?? []
      tags.push(element.outerHTML)
      meta[identity] = tags
    }
  }
  const links: Record<string, string[]> = {}
  for (const element of document.head.querySelectorAll('link')) {
    const identity = getLinkIdentity(element)
    if (identity) {
      const tags = links[identity] ?? []
      tags.push(element.outerHTML)
      links[identity] = tags
    }
  }
  return {
    title: document.head.querySelector('title')?.outerHTML ?? null,
    meta,
    links,
  }
}

function createElementFromHtml(document: Document, html: string): Element | undefined {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content.firstElementChild ?? undefined
}

function findMetaElements(document: Document, identity: string): Element[] {
  return [...document.head.querySelectorAll('meta')].filter(
    (element) => getMetaIdentity(element) === identity,
  )
}

function findLinkElements(document: Document, identity: string): Element[] {
  return [...document.head.querySelectorAll('link')].filter(
    (element) => getLinkIdentity(element) === identity,
  )
}

function removeElements(elements: readonly Element[]): void {
  for (const element of elements) {
    element.remove()
  }
}

function replaceOrInsertElement(
  document: Document,
  current: Element[],
  next: Element | undefined,
): void {
  const first = current[0]
  if (!next) {
    removeElements(current)
    return
  }
  if (current.length === 1 && current[0].outerHTML === next.outerHTML) {
    return
  }
  if (first) {
    first.replaceWith(next)
    removeElements(current.slice(1))
  } else {
    document.head.append(next)
  }
}

function restoreElements(
  document: Document,
  current: Element[],
  serialized: readonly string[] | undefined,
): void {
  if (
    serialized &&
    current.length === serialized.length &&
    current.every((element, index) => element.outerHTML === serialized[index])
  ) {
    return
  }
  removeElements(current)
  for (const html of serialized ?? []) {
    const element = createElementFromHtml(document, html)
    if (element) {
      document.head.append(element)
    }
  }
}

function createMetaElement(document: Document, tag: RouteMetaTag): Element | undefined {
  const element = document.createElement('meta')
  if (tag.name !== undefined) {
    element.setAttribute('name', tag.name)
  }
  if (tag.property !== undefined) {
    element.setAttribute('property', tag.property)
  }
  if (tag.name === undefined && tag.property === undefined) {
    return undefined
  }
  element.setAttribute('content', tag.content)
  return element
}

function createLinkElement(document: Document, link: RouteMetadataLink): Element {
  const element = document.createElement('link')
  element.setAttribute('rel', link.rel)
  element.setAttribute('href', link.href)
  return element
}

function getRouteMetadata(matches: readonly RouteMatch[]): RouteMetadata | undefined {
  const key = matches.at(-1)?.route.key
  if (!key || typeof key !== 'object') {
    return undefined
  }
  return (key as { metadata?: RouteMetadata }).metadata
}

class RouteMetadataManager {
  private readonly baseline: MetadataBaseline
  private readonly metaKeys = new Set<string>()
  private readonly linkKeys = new Set<string>()

  constructor(private readonly document: Document) {
    this.baseline = collectBaseline(document)
  }

  apply(metadata: RouteMetadata | undefined): void {
    const currentTitle = this.document.head.querySelector('title')
    if (metadata?.title !== undefined) {
      if (currentTitle) {
        currentTitle.textContent = metadata.title
      } else {
        const nextTitle = this.document.createElement('title')
        nextTitle.textContent = metadata.title
        this.document.head.append(nextTitle)
      }
    } else {
      restoreElements(
        this.document,
        currentTitle ? [currentTitle] : [],
        this.baseline.title ? [this.baseline.title] : undefined,
      )
    }

    const routeMeta = new Map<string, RouteMetaTag>()
    if (metadata?.description !== undefined) {
      routeMeta.set('name:description', {
        name: 'description',
        content: metadata.description,
      })
    }
    for (const tag of metadata?.meta ?? []) {
      const identity =
        tag.name !== undefined
          ? `name:${tag.name}`
          : tag.property !== undefined
            ? `property:${tag.property}`
            : undefined
      if (identity) {
        routeMeta.set(identity, tag)
      }
    }
    for (const identity of Object.keys(this.baseline.meta)) {
      this.metaKeys.add(identity)
    }
    for (const identity of routeMeta.keys()) {
      this.metaKeys.add(identity)
    }
    for (const identity of this.metaKeys) {
      const tag = routeMeta.get(identity)
      const current = findMetaElements(this.document, identity)
      if (tag) {
        replaceOrInsertElement(this.document, current, createMetaElement(this.document, tag))
      } else {
        restoreElements(this.document, current, this.baseline.meta[identity])
      }
    }

    const routeLinks = new Map<string, RouteMetadataLink>()
    if (metadata?.canonical !== undefined) {
      routeLinks.set('rel:canonical', { rel: 'canonical', href: metadata.canonical })
    }
    for (const link of metadata?.links ?? []) {
      routeLinks.set(`rel:${link.rel}`, link)
    }
    for (const identity of Object.keys(this.baseline.links)) {
      this.linkKeys.add(identity)
    }
    for (const identity of routeLinks.keys()) {
      this.linkKeys.add(identity)
    }
    for (const identity of this.linkKeys) {
      const link = routeLinks.get(identity)
      const current = findLinkElements(this.document, identity)
      if (link) {
        replaceOrInsertElement(this.document, current, createLinkElement(this.document, link))
      } else {
        restoreElements(this.document, current, this.baseline.links[identity])
      }
    }
  }

  restore(): void {
    this.apply(undefined)
  }
}

/** Wraps a router root with automatic route metadata synchronization. */
export function __routeMetadataRoot__(
  root: Component<RouteSectionProps>,
  useMatches: () => CurrentMatches,
): Component<RouteSectionProps> {
  return (props) => {
    if (typeof document !== 'undefined') {
      const matches = useMatches()
      const manager = new RouteMetadataManager(document)
      createEffect(() => manager.apply(getRouteMetadata(matches())))
      onCleanup(() => manager.restore())
    }
    return createComponent(root, props)
  }
}
