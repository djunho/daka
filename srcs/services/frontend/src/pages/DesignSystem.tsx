import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Avatar from '../components/Avatar'
import Button from '../components/Button'
import CategoryChips from '../components/CategoryChips'
import ChatMessageBubble from '../components/ChatMessageBubble'
import ConfirmDialog from '../components/ConfirmDialog'
import Icon, { ICON_NAMES } from '../components/Icon'
import ImagePicker from '../components/ImagePicker'
import ListingCard, { LISTING_GRID_CLASSES } from '../components/ListingCard'
import LocationAutocomplete from '../components/LocationAutocomplete'
import LogoMark from '../components/Logo'
import MessageCard from '../components/MessageCard'
import OnlineBadge from '../components/OnlineBadge'
import ProfileField from '../components/ProfileField'
import {
  COLOR_GROUPS,
  DISPLAY_SAMPLES,
  SAMPLE_CATEGORIES,
  SAMPLE_LISTINGS,
  SANS_SAMPLES,
  WEIGHT_SAMPLES,
  type ColorToken,
} from './designSystemSamples'

// A living style guide: the tokens, typography, icons and reusable components
// of docs/design/design-system.md, rendered by the real code. Everything uses
// static sample data (designSystemSamples.ts), so the page never calls the API.

const SECTIONS = [
  { id: 'marca', title: 'Marca' },
  { id: 'cores', title: 'Cores' },
  { id: 'tipografia', title: 'Tipografia' },
  { id: 'icones', title: 'Ícones' },
  { id: 'componentes', title: 'Componentes' },
]

export default function DesignSystem() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-8 text-ink">
      <header className="mb-8 pb-4 border-b border-line">
        <h1 className="text-3xl md:text-4xl font-bold font-display mb-2">Design system</h1>
        <p className="text-sm text-muted max-w-2xl">
          Os tokens, a tipografia, os ícones e os componentes reutilizáveis do Daka, desenhados pelo
          próprio código da aplicação. A documentação completa está em{' '}
          <code className="text-xs bg-surface border border-line rounded px-1 py-0.5">docs/design/design-system.md</code>.
        </p>
        <nav aria-label="Secções do design system" className="mt-4">
          <ul className="flex flex-wrap gap-2">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="inline-flex items-center min-h-9 px-3.5 rounded-full border border-line bg-surface text-sm font-semibold text-label hover:border-brand no-underline"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <BrandSection />
      <ColorsSection />
      <TypographySection />
      <IconsSection />
      <ComponentsSection />
    </main>
  )
}

// --- Layout helpers -----------------------------------------------------------

function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mb-12 scroll-mt-24">
      <h2 id={`${id}-title`} className="text-2xl font-bold font-display mb-1">{title}</h2>
      <p className="text-sm text-muted mb-5 max-w-2xl">{intro}</p>
      {children}
    </section>
  )
}

// One component (or one group) on the page: a title, what it is for, the live
// example and how to use it.
function Specimen({ title, description, code, children }: { title: string; description: string; code?: string; children: ReactNode }) {
  return (
    <article className="bg-surface border border-line rounded-2xl p-5 mb-5">
      <h3 className="text-lg font-bold mb-1">{title}</h3>
      <p className="text-sm text-muted mb-4">{description}</p>
      <div className="bg-paper border border-line rounded-xl p-4">{children}</div>
      {code && (
        // Wraps instead of scrolling: a scrolling block would have to be
        // reachable with the keyboard (axe scrollable-region-focusable).
        <pre className="mt-3 text-xs bg-paper border border-line rounded-xl p-3 whitespace-pre-wrap break-words">
          <code>{code}</code>
        </pre>
      )}
    </article>
  )
}

// --- Brand ----------------------------------------------------------------------

function BrandSection() {
  return (
    <Section id="marca" title="Marca" intro="O logo é a troca num só desenho: o que tens sai, o que queres volta. Usa sempre o componente LogoMark.">
      <div className="flex flex-wrap items-end gap-8 bg-surface border border-line rounded-2xl p-5">
        <figure className="flex flex-col items-center gap-2">
          <LogoMark size="md" />
          <figcaption className="text-xs text-muted">md · 36 px (cabeçalho)</figcaption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <LogoMark size="lg" />
          <figcaption className="text-xs text-muted">lg · 44 px (login)</figcaption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <span className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-display text-2xl font-semibold text-ink">daka</span>
          </span>
          <figcaption className="text-xs text-muted">Logo + nome em Fraunces</figcaption>
        </figure>
      </div>
    </Section>
  )
}

// --- Colors ---------------------------------------------------------------------

// WCAG relative luminance and contrast ratio of two "#RRGGBB" colors.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Reads the tokens from the CSS itself, so the page always shows the values the
// app really uses (index.css is the single source of truth).
function useTokenValues(tokens: string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({})
  const key = tokens.join(',')
  useLayoutEffect(() => {
    const style = getComputedStyle(document.documentElement)
    setValues(Object.fromEntries(key.split(',').map((t) => [t, style.getPropertyValue(t).trim().toUpperCase()])))
  }, [key])
  return values
}

function ColorsSection() {
  const all = COLOR_GROUPS.flatMap((g) => g.tokens.map((t) => t.token))
  const values = useTokenValues([...all, '--color-paper', '--color-surface'])

  return (
    <Section
      id="cores"
      title="Cores"
      intro="Os componentes usam sempre tokens (bg-brand, text-muted…), nunca hexadecimais. Os valores abaixo são lidos do CSS. As cores de texto cumprem WCAG AA (4.5:1) sobre paper e surface."
    >
      {COLOR_GROUPS.map((group) => (
        <div key={group.title} className="mb-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-label mb-3">{group.title}</h3>
          <ul className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
            {group.tokens.map((t) => (
              <Swatch key={t.token} token={t} values={values} />
            ))}
          </ul>
        </div>
      ))}
    </Section>
  )
}

function Swatch({ token, values }: { token: ColorToken; values: Record<string, string> }) {
  const hex = values[token.token] ?? ''
  const paper = values['--color-paper']
  const surface = values['--color-surface']
  const ready = /^#[0-9A-F]{6}$/.test(hex) && paper && surface

  return (
    <li className="bg-surface border border-line rounded-xl overflow-hidden">
      <div className="h-16 border-b border-line" style={{ backgroundColor: `var(${token.token})` }} />
      <div className="p-3 text-sm">
        <p className="font-semibold break-all"><code>{token.token}</code></p>
        <p className="text-xs text-muted mb-1">{hex || '…'}</p>
        <p className="text-xs">{token.use}</p>
        {token.text && ready && (
          <p className="text-xs text-muted mt-1">
            Contraste: {contrast(hex, paper).toFixed(2)}:1 em paper · {contrast(hex, surface).toFixed(2)}:1 em surface
          </p>
        )}
      </div>
    </li>
  )
}

// --- Typography -----------------------------------------------------------------

function TypographySection() {
  return (
    <Section
      id="tipografia"
      title="Tipografia"
      intro="Duas famílias, carregadas do Google Fonts: Fraunces (font-display) para títulos e o nome da marca, Outfit (font-sans) para todo o resto."
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="bg-surface border border-line rounded-2xl p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-label mb-3">Fraunces · font-display</h3>
          {DISPLAY_SAMPLES.map((s) => (
            <div key={s.className} className="mb-3">
              <p className="text-xs text-muted">{s.label} · bold</p>
              <p className={`font-display font-bold ${s.className}`}>{s.text}</p>
            </div>
          ))}
        </div>
        <div className="bg-surface border border-line rounded-2xl p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-label mb-3">Outfit · font-sans</h3>
          {SANS_SAMPLES.map((s) => (
            <div key={s.className} className="mb-3">
              <p className="text-xs text-muted">{s.label}</p>
              <p className={s.className}>{s.text}</p>
            </div>
          ))}
          <p className="text-xs text-muted mt-4 mb-1">Pesos</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            {WEIGHT_SAMPLES.map((w) => (
              <span key={w.className} className={w.className}>{w.label}</span>
            ))}
          </p>
        </div>
      </div>
    </Section>
  )
}

// --- Icons ----------------------------------------------------------------------

function IconsSection() {
  return (
    <Section
      id="icones"
      title="Ícones"
      intro="Conjunto próprio (components/Icon.tsx): grelha de 24 px, só contorno, traço 1.8 e cor herdada do texto (currentColor). Decorativos por omissão; com label passam a ser lidos."
    >
      <ul className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(110px,1fr))] mb-5">
        {ICON_NAMES.map((name) => (
          <li key={name} className="flex flex-col items-center gap-2 bg-surface border border-line rounded-xl p-3">
            <Icon name={name} size={24} className="text-ink" />
            <code className="text-xs text-muted">{name}</code>
          </li>
        ))}
      </ul>
      <Specimen
        title="Tamanhos e cores"
        description="O tamanho acompanha o texto ao lado (14 px em text-sm, 16 px em text-base). A cor vem de uma classe text-* do token."
        code={`<Icon name="swap" size={16} className="text-accent" />\n<Icon name="warning" label="Erro" />  // lido como imagem "Erro"`}
      >
        <div className="flex flex-wrap items-center gap-5">
          {[14, 16, 20, 24, 28].map((size) => (
            <Icon key={size} name="swap" size={size} className="text-brand" />
          ))}
          <span className="w-px h-6 bg-line" aria-hidden="true" />
          <Icon name="swap" className="text-accent" />
          <Icon name="location" className="text-muted" />
          <Icon name="check" className="text-online" />
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-brand text-surface">
            <Icon name="chat" size={18} />
          </span>
        </div>
      </Specimen>
    </Section>
  )
}

// --- Components -----------------------------------------------------------------

const BUTTON_VARIANTS = ['primary', 'secondary', 'danger', 'dangerOutline', 'ghost', 'link'] as const
const BUTTON_SIZES = ['sm', 'md', 'lg'] as const

// React 18 does not know the inert attribute, so it is set on the element
// (as in CategoryChips). Used around the sample listing cards: they are real
// links, and a click would lead to listings that do not exist.
function InertPreview({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    ref.current?.setAttribute('inert', '')
  }, [])
  return <div ref={ref}>{children}</div>
}

function ComponentsSection() {
  const [activeCategory, setActiveCategory] = useState<number | null>(2)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pickerMessage, setPickerMessage] = useState('Nenhuma imagem escolhida.')
  const [location, setLocation] = useState('')
  const [name, setName] = useState('ana')

  return (
    <Section
      id="componentes"
      title="Componentes"
      intro="Componentes reutilizáveis em src/components, aqui com dados de exemplo. Os mesmos ficheiros são usados nas páginas da aplicação."
    >
      <Specimen
        title="Button"
        description="Botão de ação. 6 variantes × 3 tamanhos; link não tem caixa e pode ficar dentro de uma frase. loading mostra um spinner e desativa o botão. Aceita ref (por exemplo para devolver o foco). buttonClasses() dá o mesmo aspeto a um <Link>."
        code={`<Button variant="primary" size="md" onClick={save}>Guardar</Button>\n<Button variant="link" onClick={clearFilters}>Limpar filtros</Button>\n<Button loading>A guardar…</Button>\n<Link to="/publish" className={buttonClasses({ variant: 'primary' })}>Publicar</Link>`}
      >
        <div className="space-y-3">
          {BUTTON_SIZES.map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-2">
              <span className="w-8 text-xs text-muted">{size}</span>
              {BUTTON_VARIANTS.map((variant) => (
                <Button key={variant} variant={variant} size={size}>{variant}</Button>
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-8 text-xs text-muted">estado</span>
            <Button variant="primary" disabled>disabled</Button>
            <Button variant="primary" loading>loading</Button>
            <Button variant="primary"><Icon name="plus" size={16} /> com ícone</Button>
          </div>
        </div>
      </Specimen>

      <Specimen
        title="Avatar"
        description="Foto de perfil, ou a inicial do nome quando não há foto. Com online, junta o OnlineBadge no canto."
        code={`<Avatar avatar={user.avatar} user_name={user.user_name} size="sm" online={user.is_online} />`}
      >
        <div className="flex flex-wrap items-center gap-5">
          <Avatar user_name="Ana" size="lg" />
          <Avatar user_name="Rui" size="sm" />
          <Avatar user_name="Eva" size="xs" />
          <Avatar user_name="Ana" size="lg" online />
          <Avatar user_name="Rui" size="sm" online={false} />
        </div>
      </Specimen>

      <Specimen
        title="OnlineBadge"
        description="Presença de um utilizador. Sem showLabel o estado continua a ser lido pelos leitores de ecrã (sr-only)."
        code={`<OnlineBadge online={user.is_online} showLabel />`}
      >
        <div className="flex flex-wrap items-center gap-5">
          <OnlineBadge online showLabel />
          <OnlineBadge online={false} showLabel />
          <OnlineBadge online size="lg" />
          <OnlineBadge online={false} size="xs" />
        </div>
      </Specimen>

      <Specimen
        title="ListingCard"
        description="Cartão de anúncio das listagens: categoria, estado, o que tem e o que quer (a cor accent). Sem foto, usa a cor da categoria."
        code={`<div className={LISTING_GRID_CLASSES}>\n  {listings.map((l) => <ListingCard key={l.id} listing={l} />)}\n</div>`}
      >
        <InertPreview>
          <div className={LISTING_GRID_CLASSES}>
            {SAMPLE_LISTINGS.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </InertPreview>
      </Specimen>

      <Specimen
        title="CategoryChips"
        description="Filtro por categoria. Um chip ativo usa brand-soft; com três linhas ou mais, recolhe e mostra “Ver todas”."
        code={`<CategoryChips categories={categories} active={categoryId} onToggle={toggleCategory} />`}
      >
        <div className="-mx-4 -mt-5">
          <CategoryChips
            categories={SAMPLE_CATEGORIES}
            active={activeCategory}
            onToggle={(id) => setActiveCategory((current) => (current === id ? null : id))}
          />
        </div>
      </Specimen>

      <Specimen
        title="ChatMessageBubble"
        description="Uma mensagem do chat: as enviadas à direita em brand, as recebidas à esquerda em surface."
        code={`<ChatMessageBubble content={m.content} createdAt={m.created_at} isOwn={m.sender_id === me.id} senderName="Ana" />`}
      >
        <div className="flex flex-col gap-2 max-w-sm">
          <ChatMessageBubble content="Olá! Ainda tens os livros?" createdAt="2026-11-07T10:02:00Z" isOwn={false} senderName="Ana" />
          <ChatMessageBubble content="Tenho sim. Trocas por um jogo de tabuleiro?" createdAt="2026-11-07T10:04:00Z" isOwn />
        </div>
      </Specimen>

      <Specimen
        title="ConfirmDialog"
        description="Confirmação de ações destrutivas, sobre o <dialog> nativo: foco preso no diálogo, Esc fecha e o foco volta ao botão que o abriu."
        code={`<ConfirmDialog open={open} title="Apagar fotografia?" message="…" confirmLabel="Sim, apagar"\n  busyLabel="A apagar…" busy={busy} onConfirm={remove} onCancel={() => setOpen(false)} />`}
      >
        <Button variant="dangerOutline" onClick={() => setDialogOpen(true)}>Abrir diálogo de exemplo</Button>
        <ConfirmDialog
          open={dialogOpen}
          title="Apagar este exemplo?"
          message="Isto é só uma demonstração: nada é apagado."
          confirmLabel="Sim, apagar"
          busyLabel="A apagar…"
          busy={false}
          onConfirm={() => setDialogOpen(false)}
          onCancel={() => setDialogOpen(false)}
        />
      </Specimen>

      <Specimen
        title="MessageCard"
        description="Ocupa a página quando ela não tem mais nada para mostrar: não encontrado, sem acesso, erro ao carregar."
        code={`<MessageCard title="Anúncio não encontrado" text="…" action={<Link to="/">Voltar ao início</Link>} />`}
      >
        <MessageCard
          as="section"
          title="Anúncio não encontrado"
          text="Este anúncio já não existe ou foi removido."
          action={<Button variant="primary">Voltar ao início</Button>}
        />
      </Specimen>

      <Specimen
        title="ProfileField"
        description="Campo com etiqueta do perfil. Só de leitura até a pessoa escolher editar."
        code={`<ProfileField id="user_name" label="Nome" value={name} readOnly={!editing} onChange={…} />`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileField id="ds-email" label="Email (só de leitura)" value="ana@example.com" />
          <ProfileField id="ds-name" label="Nome (editável)" value={name} readOnly={false} onChange={(e) => setName(e.target.value)} />
        </div>
      </Specimen>

      <Specimen
        title="LocationAutocomplete"
        description="Escolha de concelho ou freguesia a partir dos dados oficiais, com teclado ou rato. Os dados são carregados só quando são precisos."
        code={`<LocationAutocomplete id="location" label="Localização" value={location} onChange={setLocation} />`}
      >
        <div className="max-w-sm">
          <LocationAutocomplete
            id="ds-location"
            label="Localização"
            value={location}
            placeholder="Ex.: Porto, Braga, Lisboa"
            onChange={setLocation}
          />
        </div>
      </Specimen>

      <Specimen
        title="ImagePicker"
        description="Abre o seletor de ficheiros para uma imagem e valida tipo e tamanho antes de a entregar à página. Aqui nada é enviado."
        code={`<ImagePicker label="Alterar foto" onPick={setFile} onError={setError} />`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <ImagePicker
            label="Escolher imagem"
            onPick={(file) => setPickerMessage(`Imagem aceite: ${file.name}`)}
            onError={(message) => setPickerMessage(message)}
          />
          <p role="status" className="text-xs text-muted">{pickerMessage}</p>
        </div>
      </Specimen>

      <Specimen
        title="Icon e LogoMark"
        description="Ver as secções Ícones e Marca acima."
      >
        <div className="flex items-center gap-4">
          <LogoMark />
          <Icon name="swap" size={24} className="text-accent" />
          <Icon name="chat" size={24} className="text-brand" />
        </div>
      </Specimen>
    </Section>
  )
}
