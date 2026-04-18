# Design System Specification: The Precision Ledger

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Architectural Editorial."** 

In the world of high-stakes financial document extraction, precision is not just a feature—it is the product. This system moves away from the "generic SaaS dashboard" by treating data with the reverence of a high-end financial publication. We break the traditional grid through intentional asymmetry, using generous whitespace (the "oxygen" of the layout) to guide the eye toward critical extraction results. By layering tonal surfaces rather than using rigid borders, we create a fluid, sophisticated environment that feels more like a physical workstation and less like a digital template.

---

## 2. Colors & Surface Philosophy
The palette is rooted in a deep, authoritative Navy, balanced by the organic growth signaled by Emerald Green.

### Surface Hierarchy & Nesting
We reject the "flat" web. This design system treats the interface as a series of nested layers.
- **The Base:** Use `surface` (#fbf9fa) for the primary background.
- **The Layout:** Use `surface-container-low` (#f5f3f4) for global navigation or sidebar regions.
- **The Focus:** Use `surface-container-lowest` (#ffffff) for the primary content cards where document data is displayed.
- **The "No-Line" Rule:** 1px solid borders are strictly prohibited for sectioning. Boundaries must be defined solely through background color shifts or subtle tonal transitions.

### The Glass & Gradient Rule
To achieve a signature, custom feel:
- **Glassmorphism:** Use semi-transparent `surface` colors with a `backdrop-blur: 20px` for sticky headers and floating action panels. This allows the financial data to "peak through," maintaining context.
- **Signature Gradients:** For primary CTAs and high-level data summaries, use a subtle linear gradient from `primary` (#041627) to `primary_container` (#1a2b3c) at a 135-degree angle. This adds "visual soul" and a sense of premium weight.

---

## 3. Typography
The typography strategy employs a "High-Contrast Pairing" to balance authority with utility.

- **The Voice (Manrope):** All `display` and `headline` tokens utilize Manrope. Its wide apertures and geometric forms feel modern and expensive. Use `display-lg` and `display-md` for landing moments or major document summaries to create an editorial impact.
- **The Engine (Inter):** All `title`, `body`, and `label` tokens utilize Inter. It provides unmatched legibility for the dense numeric strings and OCR (Optical Character Recognition) results central to financial extraction.
- **Scale Usage:** 
    - `headline-lg` (Manrope): Used for document titles.
    - `title-sm` (Inter, Medium weight): Used for metadata keys (e.g., "Invoice Date").
    - `body-md` (Inter, Regular): Used for extracted values.

---

## 4. Elevation & Depth
Depth is achieved through **Tonal Layering** and ambient light simulation, not artificial structure.

- **The Layering Principle:** Stack `surface-container` tiers to create lift. For example, a `surface-container-lowest` card sitting on a `surface-container-low` section creates a natural, soft lift without a single shadow.
- **Ambient Shadows:** When a floating element (like a modal or a context menu) is required, use a high-dispersion shadow:
    - **Color:** `on-surface` (#1b1c1d) at 5% opacity.
    - **Blur:** 40px – 60px.
    - **Spread:** -5px.
    - This mimics natural light rather than a dated "drop shadow" effect.
- **The "Ghost Border" Fallback:** If a container requires a boundary for accessibility (e.g., input fields), use a Ghost Border: `outline-variant` (#c4c6cd) at 15% opacity. Never use 100% opaque borders.

---

## 5. Components

### Buttons
- **Primary:** Gradient fill (`primary` to `primary_container`), `on-primary` text, `xl` (0.75rem) border radius.
- **Secondary:** `surface-container-high` background with `on-primary-container` text.
- **Tertiary:** No background; `primary` text. Use for low-emphasis actions like "Cancel."

### Extraction Cards
Forbid the use of divider lines within cards.
- **Structure:** Use vertical whitespace (1.5rem to 2rem) and `label-sm` headers to separate "Confidence Scores" from "Extracted Text."
- **Success Highlight:** When an extraction is verified, use a subtle `tertiary_container` (#00311f) background with a 2px left-accent bar in `emerald green` (#2D6A4F).

### Input Fields
- **State:** Active inputs should not change border color; instead, they should transition their background from `surface-container-highest` to `surface-container-lowest` with a "Ghost Border" appearing at 20% opacity.
- **Feedback:** Error states use `error` (#ba1a1a) text but should never utilize heavy red backgrounds. Use a 4% `error_container` tint for the field itself.

### The "Extraction Glow" Chip
A bespoke component for this system. Use `tertiary_fixed` (#b1f0ce) with `on-tertiary-fixed-variant` (#0e5138) text to highlight high-confidence extracted data points within a raw document view. Use `sm` border radius for a "stamp of approval" look.

---

## 6. Do’s and Don’ts

### Do:
- **Embrace Asymmetry:** Align primary content to a 12-column grid, but allow metadata or secondary analysis to sit in a flexible side-panel that breaks the standard gutter.
- **Use "Signature Whitespace":** Increase margins by 20% more than you think is necessary. This design system thrives on the perception of "un-crowdedness."
- **Prioritize Tonal Shifts:** Use `surface-dim` to define the footer or background utility areas.

### Don’t:
- **No Hard Dividers:** Never use a solid line to separate table rows or list items. Use a background shift on `:hover` or generous padding.
- **No Default Blue:** Avoid standard "digital blue." All primary interactions must remain in the Deep Navy (#1A2B3C) to preserve the financial authority of the platform.
- **No Sharp Corners:** Avoid the `none` or `sm` roundedness tokens for large containers. Financial data can feel cold; the `lg` and `xl` radii "soften" the technical complexity of the platform.

### Accessibility Note
While we prioritize elegance, contrast ratios for `on-surface` and `on-primary` must always meet WCAG AA standards. When using Glassmorphism, ensure the `backdrop-filter` is paired with a fallback solid color for browsers or users with reduced transparency settings.