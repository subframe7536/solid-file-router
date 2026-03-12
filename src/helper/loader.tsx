import type { RouteSectionProps } from '@solidjs/router'
import { ErrorBoundary, Suspense, untrack } from 'solid-js'
import type { Component } from 'solid-js'

type AnyComp = Component<any>

export default function (Comp: AnyComp, Loading: AnyComp, Error: AnyComp) {
  return (props: RouteSectionProps) => {
    const Catch =
      Error ||
      ((props: { error?: Error }) => (
        import.meta.env.DEV && console.error(untrack(() => props.error)), null
      ))

    const child = Loading ? (
      <Suspense fallback={<Loading {...props} />}>
        <Comp {...props} />
      </Suspense>
    ) : (
      <Comp {...props} />
    )
    return (
      <ErrorBoundary fallback={(error, reset) => <Catch error={error} reset={reset} />}>
        {child}
      </ErrorBoundary>
    )
  }
}
