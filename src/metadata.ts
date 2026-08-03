import type { RouteMatch, RouteSectionProps } from '@solidjs/router'
import { createComponent, createEffect, onCleanup } from 'solid-js'
import type { Component } from 'solid-js'

import {
  getLinkIdentity as getSharedLinkIdentity,
  getMetaIdentity as getSharedMetaIdentity,
  normalizeRouteMetadata,
} from './metadata-shared'

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
  const property = element.getAttribute('property')
  return getSharedMetaIdentity(name ?? undefined, property ?? undefined)
}

function getLinkIdentity(element: Element): string | undefined {
  const rel = element.getAttribute('rel')
  return rel === null ? undefined : getSharedLinkIdentity(rel)
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

function replaceOrInsertElements(document: Document, current: Element[], next: Element[]): void {
  if (next.length === 0) {
    removeElements(current)
    return
  }
  if (
    current.length === next.length &&
    current.every((element, index) => element.isEqualNode(next[index]))
  ) {
    return
  }
  const first = current[0]
  if (first) {
    first.replaceWith(...next)
    removeElements(current.slice(1))
  } else {
    for (const element of next) {
      document.head.append(element)
    }
  }
}

function restoreElements(
  document: Document,
  current: Element[],
  serialized: readonly string[] | undefined,
): void {
  const next = (serialized ?? [])
    .map((html) => createElementFromHtml(document, html))
    .filter((element): element is Element => element !== undefined)

  if (
    current.length === next.length &&
    current.every((element, index) => element.isEqualNode(next[index]))
  ) {
    return
  }
  removeElements(current)
  for (const element of next) {
    document.head.append(element)
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

function createMetaElements(document: Document, tags: readonly RouteMetaTag[]): Element[] {
  return tags
    .map((tag) => createMetaElement(document, tag))
    .filter((element): element is Element => element !== undefined)
}

function createLinkElement(document: Document, link: RouteMetadataLink): Element {
  const element = document.createElement('link')
  element.setAttribute('rel', link.rel)
  element.setAttribute('href', link.href)
  return element
}

function createLinkElements(document: Document, links: readonly RouteMetadataLink[]): Element[] {
  return links.map((link) => createLinkElement(document, link))
}

function getRouteMetadata(matches: readonly RouteMatch[]): RouteMetadata | undefined {
  const key = matches.at(-1)?.route.key
  if (!key || typeof key !== 'object') {
    return undefined
  }
  return (key as { metadata?: RouteMetadata }).metadata
}

/** Manages route-owned head metadata without touching unrelated assets. */
export class RouteMetadataManager {
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

    const routeMetadata = normalizeRouteMetadata(metadata)
    for (const identity of routeMetadata.meta.keys()) {
      this.metaKeys.add(identity)
    }
    for (const identity of this.metaKeys) {
      const tags = routeMetadata.meta.get(identity) ?? []
      const current = findMetaElements(this.document, identity)
      if (tags.length > 0) {
        replaceOrInsertElements(this.document, current, createMetaElements(this.document, tags))
      } else {
        restoreElements(this.document, current, this.baseline.meta[identity])
      }
    }

    for (const identity of routeMetadata.links.keys()) {
      this.linkKeys.add(identity)
    }
    for (const identity of this.linkKeys) {
      const links = routeMetadata.links.get(identity) ?? []
      const current = findLinkElements(this.document, identity)
      if (links.length > 0) {
        replaceOrInsertElements(this.document, current, createLinkElements(this.document, links))
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
