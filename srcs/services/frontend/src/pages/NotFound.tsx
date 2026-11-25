import { Link } from 'react-router-dom'
import { buttonClasses } from '../components/Button'

// Shown for any URL that matched no route (the path="*" in App.tsx).
export default function NotFound() {
  return (
    <main className="max-w-[720px] mx-auto px-4 sm:px-6 py-12">
      <h1 className="font-display font-bold tracking-tight text-[32px] mb-4">404 — página não encontrada</h1>
      <p className="text-muted text-[17px] mb-4">Este endereço não existe no Daka.</p>
      <Link className={buttonClasses()} to="/">Voltar ao início</Link>
    </main>
  )
}
