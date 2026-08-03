import type { RouteMetadata, RouteMetadataLink, RouteMetaTag } from './metadata'

export interface NormalizedRouteMetadata {
  meta: Map<string, RouteMetaTag[]>
  links: Map<string, RouteMetadataLink[]>
}

export function getMetaIdentity(name?: string, property?: string): string | undefined {
  if (name !== undefined) {
    return `name:${name}`
  }
  return property === undefined ? undefined : `property:${property}`
}

export function getLinkIdentity(rel: string): string {
  return `rel:${rel}`
}

function appendGroup<T>(groups: Map<string, T[]>, identity: string, value: T): void {
  const values = groups.get(identity) ?? []
  values.push(value)
  groups.set(identity, values)
}

export function normalizeRouteMetadata(
  metadata: RouteMetadata | undefined,
): NormalizedRouteMetadata {
  const meta = new Map<string, RouteMetaTag[]>()
  const links = new Map<string, RouteMetadataLink[]>()

  if (metadata?.description !== undefined) {
    appendGroup(meta, 'name:description', {
      name: 'description',
      content: metadata.description,
    })
  }
  for (const tag of metadata?.meta ?? []) {
    const identity = getMetaIdentity(tag.name, tag.property)
    if (identity) {
      appendGroup(meta, identity, tag)
    }
  }

  if (metadata?.canonical !== undefined) {
    appendGroup(links, getLinkIdentity('canonical'), {
      rel: 'canonical',
      href: metadata.canonical,
    })
  }
  for (const link of metadata?.links ?? []) {
    appendGroup(links, getLinkIdentity(link.rel), link)
  }

  return { meta, links }
}
