/**
 * The UI seam (new in v1, per #32's testing decisions): renders a real route
 * component inside a real router, so `<Link>` navigates the way a volunteer's
 * tap does, rather than reaching for the component function in isolation.
 *
 * A minimal router of the test's own rather than the application's generated
 * `routeTree.gen.ts` — the generated tree is every route in the application,
 * and binding a component test to all of it would make an unrelated route's
 * file a reason this one fails to build.
 */
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouteComponent,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'

export interface TestRoute {
  readonly path: string
  readonly component: RouteComponent
}

/** Renders `routes` under one router, navigated to `at`. */
export function renderRoutes(routes: readonly TestRoute[], at: string) {
  const rootRoute = createRootRoute()
  const children = routes.map((route) =>
    createRoute({ getParentRoute: () => rootRoute, path: route.path, component: route.component }),
  )
  const routeTree = rootRoute.addChildren(children)
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [at] }),
  })
  return { ...render(<RouterProvider router={router} />), router }
}

/** The common case: one route, nothing to navigate to from it. */
export function renderRoute(path: string, component: RouteComponent) {
  return renderRoutes([{ path, component }], path)
}
