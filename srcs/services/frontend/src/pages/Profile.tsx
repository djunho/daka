import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ProfileField from '../components/ProfileField'
import LocationAutocomplete from '../components/LocationAutocomplete'
import Avatar from '../components/Avatar'
import ImagePicker from '../components/ImagePicker'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { ApiError } from '../lib/api'

export default function Profile() {
  const { user, updateProfile, uploadAvatar, removeAvatar, deleteAccount } = useAuth()

  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
      user_name: user?.user_name || '',
      user_location: user?.user_location || '',
      email: user?.email || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Focus management refs for delete confirmation modal dialog (W3C ARIA Dialog)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  // Avatar changes wait here while editing and are only sent by "Guardar
  // alterações", together with the other fields. avatarFile is a new photo
  // (shown as a preview); avatarRemoved means "go back to the initial".
  // Hooks stay above the early return (Rules of Hooks).
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarRemoved, setAvatarRemoved] = useState(false)
  const avatarPreview = useObjectUrl(avatarFile)

  useEffect(() => {
    if (user) {
      setFormData({
        user_name: user.user_name,
        user_location: user.user_location || '',
        email: user.email,
      })
    }
  }, [user])

  const prevShowDeleteModalRef = useRef(false)

  // Manage delete confirmation modal accessibility:
  // - Focus trap inside dialog (Tab / Shift+Tab cycling)
  // - Close on Escape
  // - Prevent body scroll behind dialog
  // Hooks must stay above the early return (Rules of Hooks).
  useEffect(() => {
    if (!showDeleteModal) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Move initial focus to the Cancel button inside the dialog
    const frameId = requestAnimationFrame(() => {
      cancelBtnRef.current?.focus()
    })

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !deleting) {
        setShowDeleteModal(false)
        return
      }

      // Trap focus between Cancel and Confirm buttons while dialog is open
      if (e.key === 'Tab') {
        const cancelBtn = cancelBtnRef.current
        const confirmBtn = confirmBtnRef.current
        if (!cancelBtn || !confirmBtn) return

        if (document.activeElement !== cancelBtn && document.activeElement !== confirmBtn) {
          e.preventDefault()
          cancelBtn.focus()
          return
        }

        if (e.shiftKey) {
          if (document.activeElement === cancelBtn) {
            e.preventDefault()
            confirmBtn.focus()
          }
        } else {
          if (document.activeElement === confirmBtn) {
            e.preventDefault()
            cancelBtn.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = originalOverflow
    }
  }, [showDeleteModal, deleting])

  // Restore focus to the trigger button when dialog closes
  useEffect(() => {
    if (prevShowDeleteModalRef.current && !showDeleteModal) {
      deleteTriggerRef.current?.focus()
    }
    prevShowDeleteModalRef.current = showDeleteModal
  }, [showDeleteModal])

  if (!user) {
      return (
          <main className="page">
          <h1 className="page-title">Erro ao carregar dados do utilizador</h1>
          <Link className="btn" to="/">Voltar ao início</Link>
          </main>
      )
  }

  // What the avatar circle currently shows: a picked photo, or the saved one
  // unless it was marked for removal.
  const showsAvatar = avatarFile !== null || (!avatarRemoved && !!user.avatar)

  // Format date: "setembro de 2026"
  const memberSince = new Date(user.created_at).toLocaleDateString('pt-PT', {
    month: 'long',
    year: 'numeric',
  })

  // Cancel: Discard changes by resetting formData to the current user, then exit edit mode
  function handleCancel() {
    if (!user) return

    setFormData({
      user_name: user.user_name,
      user_location: user.user_location || '',
      email: user.email,
    })
    setAvatarFile(null)
    setAvatarRemoved(false)
    setError(null)
    setIsEditing(false)
  }

  // Save: validate and send the updated data to the backend
  async function handleSave() {
    setError(null)

    // Trim values and count Unicode code points to match Python's len() in backend
    const trimmedName = formData.user_name.trim()
    const trimmedLocation = formData.user_location.trim()
    const nameLength = [...trimmedName].length
    const locationLength = [...trimmedLocation].length

    if (nameLength < 2) {
      setError('O nome de utilizador deve ter pelo menos 2 caracteres visíveis.')
      return
    }

    // 100 is defined on backend (database)
    if (nameLength > 100) {
      setError('O nome de utilizador não pode ter mais de 100 caracteres.')
      return
    }

    if (locationLength > 100) {
      setError('A localização não pode ter mais de 100 caracteres.')
      return
    }

    // Check if some change was made
    const hasNameChanged = trimmedName !== user?.user_name
    const hasLocationChanged = (trimmedLocation || null) !== (user?.user_location || null)
    // Removing only counts if there is a saved avatar to remove.
    const removeSavedAvatar = avatarRemoved && !!user?.avatar
    const hasAvatarChanged = avatarFile !== null || removeSavedAvatar

    if (!hasNameChanged && !hasLocationChanged && !hasAvatarChanged) {
      handleCancel()
      return
    }

    setSaving(true)
    try {
      // Name and location first. If the photo then fails, the fields are
      // already saved and pressing "Guardar" again only retries the photo.
      if (hasNameChanged || hasLocationChanged) {
        await updateProfile({
          user_name: trimmedName,
          user_location: trimmedLocation || null,
        })
      }
      if (avatarFile) {
        await uploadAvatar(avatarFile)
      } else if (removeSavedAvatar) {
        await removeAvatar()
      }
      setAvatarFile(null)
      setAvatarRemoved(false)
      setIsEditing(false)
    } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Erro desconhecido ao guardar alterações. Por favor, tente novamente.')
    } finally {
        setSaving(false)
    }
  }

  async function handleDeleteAccount() {
    setError(null)
    setDeleting(true)
    try {
      await deleteAccount()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Erro desconhecido. Não foi possível eliminar a conta. Por favor, tenta novamente.'
      )
      setDeleting(false)
      setShowDeleteModal(false)
    }
  }

  return (
    <main className="max-w-xl mx-auto px-4 py-8">
      {/* Error Banner if exists */}
      { error && 
        <div className="fixed top-6 right-6 z-50 flex items-center gap-3 bg-surface border border-accent/40 text-accent px-4 py-3 rounded-xl shadow-xl max-w-sm" role="alert">
          <span className="block sm:inline">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-muted hover:text-ink text-xs font-bold p-1 ml-auto transition-colors"
            aria-label="Fechar alerta"
          >
            ✕
          </button>
        </div>
      }
      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-4 pb-6 border-b border-line">
          <Avatar
            avatar={avatarPreview ?? (avatarRemoved ? null : user.avatar)}
            user_name={user.user_name}
          />

          {/* User Name & Subtitle */}
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">
              {user.user_name}
            </h1>
            <p className="text-sm text-muted">
              Membro desde {memberSince}
            </p>

            {/* Avatar actions, only while editing. They change the preview;
                "Guardar alterações" is what sends them. */}
            {isEditing && (
              <div className="flex items-center gap-2 mt-2">
                <ImagePicker
                  label={showsAvatar ? 'Alterar foto' : 'Adicionar foto'}
                  onPick={(file) => {
                    setError(null)
                    setAvatarFile(file)
                    setAvatarRemoved(false)
                  }}
                  onError={setError}
                  disabled={saving}
                />
                {showsAvatar && (
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarFile(null)
                      setAvatarRemoved(true)
                    }}
                    disabled={saving}
                    className={"text-xs font-medium text-muted hover:text-ink px-2.5 py-1 rounded-lg transition-colors" +
                              " disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted"}
                  >
                    Remover foto
                  </button>
                )}
              </div>
            )}
          </div>
        </div>


        {/* --- User Details (Form Fields) --- */}
        <div className="py-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-wider font-bold text-muted">
              Dados da conta
            </h2>

            {!isEditing ? (
              <button
                type="button"
                className="text-xs font-semibold text-brand hover:underline"
                onClick={() => setIsEditing(true)}
              >
                Editar perfil
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleCancel}
                  className={"text-xs font-medium text-muted hover:text-ink px-2.5 py-1 rounded-lg transition-colors" +
                            " disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted"}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className={"text-xs font-semibold bg-brand text-surface px-3 py-1.5 rounded-lg hover:opacity-95 transition-opacity" +
                            " disabled:opacity-40 disabled:cursor-not-allowed"}
                >
                  {saving ? 'A guardar...' : 'Guardar alterações'}
                </button>
              </div>
            )}
          </div>

          {/* Name Field */}
          <ProfileField
            id="user_name"
            label="Nome de utilizador"
            value={formData.user_name}
            readOnly={!isEditing || saving}
            onChange={(e) => setFormData({ ...formData, user_name: e.target.value })}
          />

          {/* Email Field */}
          <ProfileField
            id="email"
            label="Email"
            value={formData.email}
            //readOnly={!isEditing || saving}
            readOnly={true} // Email is not editable for now
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />

          {/* Location Field with Autocomplete */}
          <LocationAutocomplete
            id="user_location"
            label="Localização"
            value={formData.user_location || ''}
            placeholder={isEditing ? 'Escreva a sua localidade (ex.: Guimarães, Porto, Lisboa)' : 'Sem localização definida'}
            readOnly={!isEditing}
            disabled={saving}
            // Spread operator preserves other form fields (user_name, email) while updating location
            onChange={(val) => setFormData({ ...formData, user_location: val })}
          />
        </div>

        {/* --- Danger Zone (Account Deletion) --- */}
        <div className="pt-6 border-t border-line">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-accent/20 bg-accent/[0.02]">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-accent">
                Zona de perigo
              </h3>
              <p className="text-xs text-muted mt-1">
                Ao eliminares a tua conta, todos os teus anúncios e propostas de troca serão cancelados de forma definitiva.
              </p>
            </div>
            <button
              ref={deleteTriggerRef}
              type="button"
              onClick={() => setShowDeleteModal(true)}
              disabled={isEditing || saving || deleting}
              className={
                'px-3.5 py-2 text-xs font-semibold text-accent border border-accent/30 rounded-xl transition-colors whitespace-nowrap self-start ' +
                'enabled:hover:bg-accent enabled:hover:text-white ' +
                'disabled:opacity-40 disabled:pointer-events-none ' +
                'sm:self-auto'
              }
            >
              Eliminar conta
            </button>
          </div>
        </div>

        <div className="mt-6">
          <Link className="btn" to="/">Voltar ao início</Link>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          aria-describedby="delete-account-description"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-xs"
        >
          <div className="w-full max-w-md bg-surface border border-line rounded-2xl p-6 shadow-2xl space-y-4">
            <h3 id="delete-account-title" className="text-base font-bold text-ink">
              Eliminar conta
            </h3>
            <p id="delete-account-description" className="text-sm text-muted">
              Tens a certeza de que desejas eliminar a tua conta? Esta ação é irreversível. Todos os teus anúncios serão removidos e as tuas propostas de troca ativas serão canceladas.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                ref={cancelBtnRef}
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className={
                  'px-4 py-2 text-xs font-medium text-muted transition-colors ' +
                  'enabled:hover:text-ink ' +
                  'disabled:opacity-40 disabled:pointer-events-none'
                }
              >
                Cancelar
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleting}
                className={
                  'px-4 py-2 text-xs font-semibold bg-accent text-white rounded-xl transition-opacity ' +
                  'enabled:hover:opacity-90 ' +
                  'disabled:opacity-40 disabled:pointer-events-none'
                }
              >
                {deleting ? 'A eliminar...' : 'Sim, eliminar conta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
