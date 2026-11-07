# Design System

This document defines Daka's visual identity and the reusable pieces the frontend is built from: color tokens, typography, icons and components.

- **Live style guide:** [`https://localhost:8443/design-system`](https://localhost:8443/design-system) (also linked in the footer). It renders the real tokens, icons and components with sample data.
- **Source of truth:** the tokens live in [`srcs/services/frontend/src/index.css`](../../srcs/services/frontend/src/index.css) and the components in [`srcs/services/frontend/src/components/`](../../srcs/services/frontend/src/components/).
- Everything is built in-house: no UI or icon library.

---

# Logo

The mark is the trade in one picture: two arrows going opposite ways on the brand square (what you have goes out, what you want comes back). Always use the `LogoMark` component ([`components/Logo.tsx`](../../srcs/services/frontend/src/components/Logo.tsx)), never a copy of its SVG.

## Color Palette

| Preview | CSS Variable | HEX | Description |
| --- | --- | --- | --- |
| ![](https://dummyimage.com/40x24/246C5E/FFFFFF&text=+) | `--color-brand` | `#246C5E` | Background square |
| ![](https://dummyimage.com/40x24/FFFFFF/FFFFFF&text=+) | `--color-surface` | `#FFFFFF` | Right arrow (what you have) |
| ![](https://dummyimage.com/40x24/DF3D31/FFFFFF&text=+) | `--color-logo-accent` | `#DF3D31` | Left arrow (what you want) |
| ![](https://dummyimage.com/40x24/15231F/FFFFFF&text=+) | `--color-ink` | `#15231F` | "daka" name next to the mark (Fraunces) |

## Sizes

| `size` | Box | Where |
| --- | --- | --- |
| `md` (default) | 36 px | Header |
| `lg` | 44 px | Login card |

```tsx
<LogoMark />
<LogoMark size="lg" />
```

The mark is decorative (`aria-hidden`): it always sits next to the "daka" name or inside a link that already has a name ("Daka — home").

---

# Color Tokens

Tokens are declared once in `index.css`, inside Tailwind v4's `@theme static` block. Tailwind turns each `--color-<name>` into utilities, so components write `bg-brand`, `text-muted` or `border-line` and never a hexadecimal value. `static` makes Tailwind always emit every token as a CSS variable, even one no class uses: the logo and the `/design-system` page read them with `var()` and `getComputedStyle`.

## Brand

| Preview | CSS Variable | HEX | Usage |
| --- | --- | --- | --- |
| ![](https://dummyimage.com/40x24/246C5E/FFFFFF&text=+) | `--color-brand` | `#246C5E` | Primary buttons, logo background, the "has" side of a trade, links, focus ring |
| ![](https://dummyimage.com/40x24/DCEBE8/FFFFFF&text=+) | `--color-brand-soft` | `#DCEBE8` | Active category chip, photo fallback tint |
| ![](https://dummyimage.com/40x24/D52E21/FFFFFF&text=+) | `--color-accent` | `#D52E21` | The "wants" side of a trade, destructive actions, errors |
| ![](https://dummyimage.com/40x24/DF3D31/FFFFFF&text=+) | `--color-logo-accent` | `#DF3D31` | Only the logo's left arrow. Never text (see Accessibility) |

## Surfaces and lines

| Preview | CSS Variable | HEX | Usage |
| --- | --- | --- | --- |
| ![](https://dummyimage.com/40x24/F2F9F7/FFFFFF&text=+) | `--color-paper` | `#F2F9F7` | Page background, inner panels |
| ![](https://dummyimage.com/40x24/FFFFFF/FFFFFF&text=+) | `--color-surface` | `#FFFFFF` | Cards, header, inputs; text on brand buttons |
| ![](https://dummyimage.com/40x24/BCD7D1/FFFFFF&text=+) | `--color-line` | `#BCD7D1` | Borders, outlines and separators |

## Text

Contrast measured with the WCAG 2.1 formula. Every text token reaches AA (4.5:1) on both page backgrounds.

| Preview | CSS Variable | HEX | Usage | on `paper` | on `surface` |
| --- | --- | --- | --- | --- | --- |
| ![](https://dummyimage.com/40x24/15231F/FFFFFF&text=+) | `--color-ink` | `#15231F` | Primary text and headings | 15.22:1 | 16.25:1 |
| ![](https://dummyimage.com/40x24/4B7871/FFFFFF&text=+) | `--color-muted` | `#4B7871` | Secondary text, placeholders, metadata | 4.66:1 | 4.97:1 |
| ![](https://dummyimage.com/40x24/314A46/FFFFFF&text=+) | `--color-label` | `#314A46` | Category labels, unselected toggles, text on `brand-soft` | 8.95:1 | 9.55:1 |
| ![](https://dummyimage.com/40x24/246C5E/FFFFFF&text=+) | `--color-brand` | `#246C5E` | "Has" text, links | 5.82:1 | 6.21:1 |
| ![](https://dummyimage.com/40x24/D52E21/FFFFFF&text=+) | `--color-accent` | `#D52E21` | "Wants" text, errors | 4.64:1 | 4.95:1 |

White text on `--color-brand` (primary button): 6.21:1.

## State

| Preview | CSS Variable | HEX | Usage |
| --- | --- | --- | --- |
| ![](https://dummyimage.com/40x24/10B981/FFFFFF&text=+) | `--color-online` | `#10B981` | `OnlineBadge` dot, online |
| ![](https://dummyimage.com/40x24/A1A1AA/FFFFFF&text=+) | `--color-offline` | `#A1A1AA` | `OnlineBadge` dot, offline |

The dot never carries the meaning alone: `OnlineBadge` always has the text "Online" / "Offline" (visible or `sr-only`).

## Naming convention

- Names describe the **role**, not the color: `brand`, `accent`, `ink`, `muted`, `paper`, `surface`, `line`.
- Use the Tailwind utility generated from the token (`bg-surface`, `text-label`, `border-line`). Use `var(--color-…)` only where a class cannot reach, such as SVG `stroke` attributes or inline styles.
- A new color needs a new token in `index.css`, a row in this document and, if it is a text color, its contrast on `paper` and `surface`.

---

# Typography

## Fonts

Both families are loaded from Google Fonts in `index.html`.

| Token | Font | Fallback | Source | Usage |
| --- | --- | --- | --- | --- |
| `--font-display` (`font-display`) | Fraunces 600/700 | Georgia, Times New Roman, serif | [Fraunces at Google Fonts](https://fonts.google.com/specimen/Fraunces?preview.script=Latn) | Page titles, section headings, the "daka" name |
| `--font-sans` (`font-sans`, default) | Outfit 400–700 | system-ui, -apple-system, Segoe UI, Roboto, sans-serif | [Outfit at Google Fonts](https://fonts.google.com/specimen/Outfit?preview.script=Latn) | Everything else (body, forms, buttons) |

## Scale

| Class | Size | Typical use |
| --- | --- | --- |
| `text-4xl` | 36 px | Page title on desktop (`font-display`, bold) |
| `text-3xl` | 30 px | Page title on mobile, login brand |
| `text-2xl` | 24 px | Section headings, header brand |
| `text-lg` | 18 px | Card and component titles |
| `text-base` | 16 px | Body text |
| `text-sm` | 14 px | Cards, buttons, lists, helper text |
| `text-xs` | 12 px | Labels, metadata, badges |

Weights: 400 (body), 500 (links, menu items), 600 (buttons, emphasis), 700 (titles, labels). Line height is 1.5 (set on `body`).

---

# Icons

Daka has its own icon set in [`components/Icon.tsx`](../../srcs/services/frontend/src/components/Icon.tsx). Emojis and Unicode symbols (✕, ⇄, 📍…) are **not** used as icons: they look different on every operating system and browser.

## Drawing rules

Every icon follows the same rules, so they read as one family:

- 24 × 24 `viewBox`, outline only (`fill="none"`);
- `stroke="currentColor"`, so the icon takes the color of the text around it, and that color comes from a token class (`text-accent`, `text-muted`…);
- stroke width 1.8, round caps and joins.

## Catalogue

| Name | Used for |
| --- | --- |
| `close` | Close or dismiss (notices, chat, photo removal) |
| `check` | Success notices and confirmations |
| `plus` | Create (the "Publicar" button) |
| `minus` | Minimize the chat |
| `chevron-up` / `chevron-down` | Expand / collapse (category chips, chat) |
| `swap` | The trade itself: "wants" text, negotiations dock |
| `chat` | Chat and conversations |
| `inbox` | Empty negotiations list |
| `document` | Negotiation details |
| `location` | A user's or a listing's location |
| `warning` | Error messages |
| `refresh` | Reload a list |
| `arrow-right` | "See all" links |
| `eye` / `eye-off` | Show / hide the password |
| `user` | Account menu without an avatar |

## Usage

```tsx
<Icon name="swap" size={16} className="text-accent" />   // decorative (default)
<Icon name="warning" label="Erro" />                      // announced as an image "Erro"
```

- **Size** follows the text next to it: 12 px with `text-xs`, 14 px with `text-sm`, 16 px with `text-base`. Default 20 px.
- **Accessibility:** decorative by default (`aria-hidden`). An icon-only button gets its name from an `aria-label` **on the button**, and the icon inside stays decorative. Pass `label` only when the icon alone carries meaning outside a button.
- **Alignment:** an SVG has no text baseline. Inside `items-baseline` rows use `self-center`; inline in a sentence use `inline-block` with a small negative `align-[…]`.
- **Adding an icon:** add its name to `ICON_NAMES` and its paths to `PATHS`, following the drawing rules. It then appears on the `/design-system` page by itself.

**Exception:** the Google logo on the login button stays a separate multicolor SVG in `Login.tsx`, because Google's sign-in branding rules forbid redrawing or recoloring it.

---

# Accessibility

- Maintain sufficient contrast between text and background: at least 4.5:1 for normal text and 3:1 for large text (WCAG 2.1 AA).
  - `--color-muted` (`#4B7871`) and `--color-accent` (`#D52E21`) were darkened from `#598E86` and `#DF3D31` to reach 4.5:1 on `--color-paper` (`#F2F9F7`) and `--color-surface` (`#FFFFFF`).
  - Avoid `--color-muted` and `--color-accent` text on `--color-brand-soft` (`#DCEBE8`), where they only reach about 4.0:1. For secondary text there, use `--color-label` (`#314A46`).
  - The logo's left arrow keeps the original `#DF3D31` as its own token, `--color-logo-accent`. It is part of the logo, decorative and hidden from screen readers, not text, so the text contrast rule does not apply. Never use this token for text.
- Do not rely exclusively on color to convey information (e.g. `OnlineBadge` always has text, links inside paragraphs are underlined).
- Ensure interactive elements have visible hover and focus states. The focus ring (`:focus-visible`, 2 px `--color-brand`) is global in `index.css`.
- Prefer semantic design tokens over hardcoded hexadecimal values.

---

# Components

Reusable components live in `src/components/`. Each block below says what the component is for, its props and its accessibility notes. All of them except `ListingFields` are rendered on the `/design-system` page.

App-specific pieces (`Header`, `Layout`, `NegotiationChatWidget`, `NegotiationsDock`, `ListingGallery`, `ListingPhotoManager`, `ProposalForm`, `RequireAuth`) are built **from** these components and tokens, but are not part of the design system.

## Button

- Action button. Defaults to `type="button"`, so a button inside a form never submits by accident.
- Props: `variant` (`primary` · `secondary` (default) · `danger` · `dangerOutline` · `ghost` · `link`), `size` (`sm` · `md` (default) · `lg`), `loading` (spinner, disabled, `aria-busy`), plus every native `<button>` attribute.
- `link` is a text action that looks like a link ("Limpar filtros", "Editar perfil", "Regista-te grátis"): brand text, underline on hover, **no padding and no rounded box**, so it can sit inside a sentence. For it, `size` only sets the text size (`sm` 12 px, `md` 14 px, `lg` 16 px); add padding through `className` when it needs a bigger touch area.
- Accepts a `ref` (`forwardRef`), e.g. to give the focus back to the button after a form it opened is closed.
- `buttonClasses({ variant, size, className })` gives the same look to a `<Link>`.

```tsx
<Button variant="primary" onClick={save}>Guardar</Button>
<Button variant="link" onClick={clearFilters}>Limpar filtros</Button>
<Button loading>A guardar…</Button>
<Button ref={newProposalRef} variant="primary" size="sm">Criar proposta</Button>
<Link to="/publish" className={buttonClasses({ variant: 'primary' })}>Publicar</Link>
```

**Native `<button>` on purpose.** Two kinds of buttons do not use `Button`, because its padding, rounded box and light-surface colors do not fit them:

- **Icon-only buttons** (close a notice, dismiss an error, show the password, remove a photo, chat and dock controls): their color comes from the container (white on the brand header, accent on an error banner, over a photo) and they are small or absolutely positioned. They always have an `aria-label`, and the `Icon` inside stays decorative.
- **Segmented controls** (the "Entrar / Criar conta" switch on the login page): two halves of one control that fill the width, with a selected state. That is a different pattern from an action button.

## Icon

See [Icons](#icons).

## LogoMark

See [Logo](#logo).

## Avatar

- Profile picture, or the first letter of the name when there is none.
- Props: `avatar` (URL or `null`), `user_name`, `size` (`xs` 28 px · `sm` 48 px · `lg` 80 px (default)), `online` (optional: adds an `OnlineBadge` in the corner).
- The image's `alt` is the user name.

```tsx
<Avatar avatar={user.avatar} user_name={user.user_name} size="sm" online={user.is_online} />
```

## OnlineBadge

- Reusable presence indicator for online state.
- Colors: green for online (`bg-online`) and gray for offline (`bg-offline`), from the `--color-online` and `--color-offline` theme tokens.
- Always includes accessible text (`Online` / `Offline`), with optional visible label.
- Supports Avatar sizes: `xs`, `sm`, `lg`.

Usage examples:

```tsx
<OnlineBadge online={friend.is_online} />
<OnlineBadge online={friend.is_online} showLabel />
<Avatar avatar={friend.avatar} user_name={friend.user_name} size="sm" online={friend.is_online} />
```

## ListingCard

- The listing card of every grid (home, public profile): cover photo or category tint, condition, category, title, the "wants" line in `accent`, location and owner.
- Props: `listing` (`ApiListingSummary`). The whole card is one link to the listing.
- Use it inside `LISTING_GRID_CLASSES`; `EMPTY_STATE_CLASSES` styles the "no results" box of the same grids.

```tsx
<div className={LISTING_GRID_CLASSES}>
  {listings.map((l) => <ListingCard key={l.id} listing={l} />)}
</div>
```

## CategoryChips

- Category filter as toggle chips (`aria-pressed`). The active chip uses `brand-soft` with `brand` text.
- Props: `categories`, `active` (id or `null`), `onToggle(id)`.
- When the chips need three rows or more, only the first row shows, with a "Ver todas (N)" toggle. Hidden chips are `inert`, so they take no focus.

```tsx
<CategoryChips categories={categories} active={categoryId} onToggle={toggleCategory} />
```

## ChatMessageBubble

- One chat message: sent messages on the right in `brand`, received ones on the left in `surface`, with the time (pt-PT).
- Props: `content`, `createdAt` (ISO 8601), `isOwn`, `senderName` (received messages only).

```tsx
<ChatMessageBubble content={m.content} createdAt={m.created_at} isOwn={m.sender_id === me.id} />
```

## ConfirmDialog

- Confirmation for destructive actions, built on the native `<dialog>` with `showModal()`: focus stays in the dialog, Esc closes it, the page behind is inert and the focus returns to the button that opened it.
- Props: `open`, `title`, `message`, `confirmLabel`, `busyLabel`, `busy`, `error`, `confirmVariant` (`danger` (default) · `primary`), `onConfirm`, `onCancel`.

```tsx
<ConfirmDialog open={open} title="Apagar fotografia?" message="…" confirmLabel="Sim, apagar"
  busyLabel="A apagar…" busy={busy} onConfirm={remove} onCancel={() => setOpen(false)} />
```

## MessageCard

- Fills a page that has nothing else to show: not found, no access, loading error.
- Props: `title` (optional), `text`, `action` (a link or a "Tentar outra vez" button), `alert` (the text is announced as soon as it appears), `as` (`main` (default) · `section`: use `section` when the card sits inside a page that already has its `<main>`).

```tsx
<MessageCard title="Anúncio não encontrado" text="…" action={<Link to="/">Voltar ao início</Link>} />
```

## ProfileField

- Labelled text field of the profile page, read-only until the user chooses to edit.
- Props: `id`, `label`, `value`, `type`, `placeholder`, `readOnly` (default `true`), `onChange`.

```tsx
<ProfileField id="user_name" label="Nome" value={name} readOnly={!editing} onChange={…} />
```

## LocationAutocomplete

- Picks a municipality or parish from official public data, with keyboard or mouse (combobox pattern). The data (~64 KB gzipped) is loaded only when the field is first used.
- Props: `id`, `label`, `value`, `onChange(value)`, plus `onSelect`, `placeholder`, `readOnly`, `disabled`, `hideLabel`, `ariaInvalid`, `ariaDescribedBy`, `className`, `inputClassName`.

```tsx
<LocationAutocomplete id="location" label="Localização" value={location} onChange={setLocation} />
```

## ImagePicker

- A button that opens the system file picker for one image and validates it (JPEG/PNG/WebP, 2 MB, same rules as the backend) before handing it to the page. Previewing and uploading belong to the page.
- Props: `label`, `onPick(file)`, `onError(message)`, `disabled`, `className`.

```tsx
<ImagePicker label="Alterar foto" onPick={setFile} onError={setError} />
```

## ListingFields

- The text fields of a listing (title, description, category, condition, location, wish), shared by the publish and edit pages. The page keeps the values and errors; this only draws the inputs.
- Props: `values`, `errors`, `categories`, `conditions`, `disabled`, `onChange(changes)`.
- Not on the `/design-system` page: it only makes sense inside a listing form.

```tsx
<ListingFields values={values} errors={errors} categories={categories} conditions={conditions}
  disabled={saving} onChange={(changes) => setValues((v) => ({ ...v, ...changes }))} />
```
