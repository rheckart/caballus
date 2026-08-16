import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main>
      <h1>Caballus</h1>
      <p>Nothing to do here yet. The barn comes next.</p>
    </main>
  )
}
