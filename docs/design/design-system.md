# Design System

This document defines the visual identity of the project.

---

# Logo

## Color Palette

| Preview | CSS Variable | HEX | Description |
| --- | --- | --- | --- |
| ![](https://dummyimage.com/40x24/FFFFFF/FFFFFF&text=+) | `TBA` | `#FFFFFF` | Right arrow |
| ![](https://dummyimage.com/40x24/246C5E/FFFFFF&text=+) | `TBA` | `#246C5E` | Background |
| ![](https://dummyimage.com/40x24/15231F/FFFFFF&text=+) | `TBA` | `#15231F` | Secondary logo color (text) |
| ![](https://dummyimage.com/40x24/DF3D31/FFFFFF&text=+) | `TBA` | `#DF3D31` | Left arrow |

---

# Typography

## Fonts

| Font | Source | Usage |
| --- | --- | --- |
| Fraunces | [Fraunces at Google Fonts](https://fonts.google.com/specimen/Fraunces?preview.script=Latn) | Hero text / marketing content |
| Outfit | [Outfit at Google Fonts](https://fonts.google.com/specimen/Outfit?preview.script=Latn) | Default application font |

---

# Text Colors

| Preview | CSS Variable | HEX | Usage |
| --- | --- | --- | --- |
| ![](https://dummyimage.com/40x24/15231F/FFFFFF&text=+) | `TBA` | `#15231F` | Primary text |
| ![](https://dummyimage.com/40x24/598E86/FFFFFF&text=+) | `TBA` | `#598E86` | Secondary text |
| ![](https://dummyimage.com/40x24/314A46/FFFFFF&text=+) | `TBA` | `#314A46` | Category labels |
| ![](https://dummyimage.com/40x24/314A46/FFFFFF&text=+) | `TBA` | `#314A46` | Unselected button text |
| ![](https://dummyimage.com/40x24/FFFFFF/FFFFFF&text=+) | `TBA` | `#FFFFFF` | Selected button text |
| ![](https://dummyimage.com/40x24/246C5E/FFFFFF&text=+) | `TBA` | `#246C5E` | "Has" text |
| ![](https://dummyimage.com/40x24/DF3D31/FFFFFF&text=+) | `TBA` | `#DF3D31` | "Wants" text |

---

# Application Colors

## General UI

| Preview | CSS Variable | HEX | Usage |
| --- | --- | --- | --- |
| ![](https://dummyimage.com/40x24/F2F9F7/FFFFFF&text=+) | `TBA` | `#F2F9F7` | Main background |
| ![](https://dummyimage.com/40x24/BCD7D1/FFFFFF&text=+) | `TBA` | `#BCD7D1` | Borders / outlines |
| ![](https://dummyimage.com/40x24/15231F/FFFFFF&text=+) | `TBA` | `#15231F` | Footer |
| ![](https://dummyimage.com/40x24/246C5E/FFFFFF&text=+) | `TBA` | `#246C5E` | Button background |
| ![](https://dummyimage.com/40x24/DCEBE8/FFFFFF&text=+) | `--color-brand-soft` | `#DCEBE8` | Active chip fill / photo fallback tint |

---

# CSS Variables

When implemented, will replace the `TBA` values above with the official design tokens.

Example:

```css
:root {
    --color-primary: #246C5E;
    --color-secondary: #15231F;
    --color-accent: #DF3D31;

    --text-primary: #15231F;
    --text-secondary: #598E86;

    --background-primary: #F2F9F7;
    --border-primary: #BCD7D1;
}
```

---

# Naming Convention

Semantic names will be implemented instead of color names.

```css
--text-primary
--background-primary
--button-primary
--button-secondary
--border-default
```


Semantic names allow the visual identity to change without affecting component code.

---

# Accessibility

- Maintain sufficient contrast between text and background.
- Do not rely exclusively on color to convey information.
- Ensure interactive elements have visible hover and focus states.
- Prefer semantic design tokens over hardcoded hexadecimal values.

---

# OnlineBadge

- Reusable presence indicator for online state.
- Colors: green for online (`bg-emerald-500`) and gray for offline (`bg-zinc-400`).
- Always includes accessible text (`Online` / `Offline`), with optional visible label.
- Supports Avatar sizes: `xs`, `sm`, `lg`.

Usage examples:

```tsx
<OnlineBadge online={friend.is_online} />
<OnlineBadge online={friend.is_online} showLabel />
<Avatar avatar={friend.avatar} user_name={friend.user_name} size="sm" online={friend.is_online} />
```