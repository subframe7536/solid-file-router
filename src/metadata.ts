/** Metadata attached to a route and applied through `useHead`. */
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
