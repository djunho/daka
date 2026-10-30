import { ApiError } from './api'

/**
 * Translates an API error or unexpected exception into a user-friendly European Portuguese (pt-PT) message.
 * Ensures backend English strings or low-level network errors are never displayed directly in the UI.
 *
 * @param err The caught error object.
 * @param fallback Context-specific default message to return if no specific status rule matches.
 * @param overrides Optional caller-specific messages keyed by HTTP status code.
 * @returns Localized error string in pt-PT.
 */
export function getPortugueseErrorMessage(
  err: unknown,
  fallback = 'Ocorreu um erro inesperado. Por favor, tenta novamente.',
  overrides?: Partial<Record<number, string>>,
): string {
  if (err instanceof ApiError) {
    if (overrides?.[err.status]) {
      return overrides[err.status]!
    }

    // Status 0: Network unreachable or server offline
    if (err.status === 0) {
      return 'Não foi possível contactar o servidor. Verifica a tua ligação à internet.'
    }

    // Status 401: Unauthorized / session expired
    if (err.status === 401) {
      return 'Precisas de iniciar sessão para realizar esta operação.'
    }

    // Status 403: Forbidden / not owner
    if (err.status === 403) {
      return 'Não tens permissão para realizar esta operação.'
    }

    // Status 404: Not found
    if (err.status === 404) {
      return 'O recurso solicitado não foi encontrado.'
    }

    // Status 409: Conflict
    if (err.status === 409) {
      return 'Não foi possível concluir o pedido devido a um conflito.'
    }

    // Status 413: Payload too large
    if (err.status === 413) {
      return 'O ficheiro é demasiado grande. O tamanho máximo permitido é 2 MB.'
    }

    // Status 415: Unsupported media type
    if (err.status === 415) {
      return 'Formato de imagem não suportado. Por favor, seleciona uma imagem JPEG, PNG ou WebP.'
    }

    // Status 422: Unprocessable Entity / validation error
    if (err.status === 422) {
      const msg = err.message.toLowerCase()
      if (msg.includes('category')) {
        return 'A categoria selecionada não é válida.'
      }
      if (msg.includes('condition')) {
        return 'O estado do artigo selecionado não é válido.'
      }
      if (msg.includes('dimension') || msg.includes('resolution')) {
        return 'As dimensões da imagem são demasiado grandes.'
      }
      return 'Dados inválidos. Por favor, verifica as informações preenchidas.'
    }

    // Status 5xx: Server internal error
    if (err.status >= 500) {
      return 'Ocorreu um erro no servidor. Por favor, tenta novamente mais tarde.'
    }
  }

  return fallback
}
