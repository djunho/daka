import { Link, useParams } from 'react-router-dom'
import { buttonClasses } from '../components/Button'

// Destination of "Iniciar negociação". For now it only gives that action
// somewhere to land: the proposals panel (#97) and the chat (#123) go here.
export default function Negotiation() {
  const { id } = useParams()
  const negotiationId = Number(id)
  const validId = Number.isInteger(negotiationId) && negotiationId > 0

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-surface border border-line rounded-2xl p-8 text-center shadow-sm">
        <h1 className="font-display text-2xl font-bold text-ink mb-2">
          {validId ? `Negociação #${negotiationId}` : 'Negociação não encontrada'}
        </h1>
        <p className="text-sm text-muted mb-6">
          {validId
            ? 'A conversa e as propostas vão aparecer aqui em breve.'
            : 'A negociação que procuras não existe.'}
        </p>
        <Link className={buttonClasses()} to="/">Voltar ao início</Link>
      </div>
    </main>
  )
}
