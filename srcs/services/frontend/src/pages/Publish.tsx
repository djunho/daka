import { useState, useEffect, useCallback } from 'react'
import {
  apiListCategories,
  apiListConditions,
  ApiCategory,
  ApiCondition,
  ApiError,
} from '../lib/api'

export default function Publish() {
  const [categories, setCategories] = useState<ApiCategory[]>([])
  const [conditions, setConditions] = useState<ApiCondition[]>([])
  const [isLoadingMeta, setIsLoadingMeta] = useState(true)
  const [metaError, setMetaError] = useState<string | null>(null)

  const loadMetadata = useCallback(async () => {
    setIsLoadingMeta(true)
    setMetaError(null)
    try {
      const [cats, conds] = await Promise.all([
        apiListCategories(),
        apiListConditions(),
      ])
      setCategories(cats)
      setConditions(conds)
    } catch (err) {
      setMetaError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível carregar as opções de publicação. Por favor, tenta novamente.',
      )
    } finally {
      setIsLoadingMeta(false)
    }
  }, [])

  useEffect(() => {
    loadMetadata()
  }, [loadMetadata])

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-surface border border-line rounded-2xl p-6 sm:p-8 shadow-sm">
        {/* Cabeçalho */}
        <div className="border-b border-line pb-4 mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Publicar anúncio</h1>
          <p className="text-sm text-muted mt-1">
            Regista um artigo que já não usas e encontra o que procuras em troca.
          </p>
        </div>

        {/* Estado: A carregar */}
        {isLoadingMeta && (
          <div className="py-12 text-center">
            <div className="inline-block w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-muted">A carregar opções de publicação…</p>
          </div>
        )}

        {/* Estado: Erro ao carregar */}
        {!isLoadingMeta && metaError && (
          <div className="bg-accent/10 border border-accent/20 rounded-xl p-4 text-center my-4">
            <p className="text-sm text-accent mb-3">{metaError}</p>
            <button
              type="button"
              onClick={loadMetadata}
              className="px-4 py-2 text-xs font-semibold bg-brand text-surface rounded-full hover:opacity-95 transition-opacity"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Formulário inicial (os campos e fotos entrarão nos passos 3 e 4) */}
        {!isLoadingMeta && !metaError && (
          <div className="space-y-6">
            <p className="text-xs text-muted">
              Opções disponíveis: {categories.length} categorias e {conditions.length} estados carregados.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
