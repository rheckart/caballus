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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

export interface TestRoute {
  readonly path: string
  readonly component: RouteComponent
  /** What the real route's loader would have answered, for a component that reads one. */
  readonly loader?: () => unknown
}

/** Renders `routes` under one router, navigated to `at`. */
export function renderRoutes(routes: readonly TestRoute[], at: string) {
  const rootRoute = createRootRoute()
  const children = routes.map((route) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: route.path,
      component: route.component,
      loader: route.loader,
    }),
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

/**
 * Picks `optionText` from the dropdown labelled `label`, so no test has to
 * know what a dropdown is made of (ADR 0025, #61): shadcn's Select is a Radix
 * listbox — a button with `role="combobox"`, options in a portal — and
 * `fireEvent.change` has nothing there to change.
 */
export async function chooseOption(label: string, optionText: string) {
  const user = userEvent.setup()
  const trigger = screen.getByRole('combobox', { name: label })
  await user.click(trigger)
  const listbox = await screen.findByRole('listbox')
  await user.click(within(listbox).getByRole('option', { name: optionText }))
}
