import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      // Built for gloves and sunlight (ADR 0007): the work surface is a phone
      // in a barn, so the viewport is never scaled away from the device.
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Caballus' },
      // The installable half of ADR 0004 (#48): a theme colour for the
      // browser chrome and the status bar of a standalone install alike.
      { name: 'theme-color', content: '#0f5d55' },
    ],
    links: [
      // The manifest and the icons it names are what turn "Add to Home
      // Screen" into a real icon opening standalone; installing stays
      // optional; nothing here changes what a plain browser tab does.
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icons/icon-192.png' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
