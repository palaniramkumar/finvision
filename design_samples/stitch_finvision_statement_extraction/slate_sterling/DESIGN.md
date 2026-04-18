# Design System Specification: The Sovereign Ledger

## 1. Overview & Creative North Star
This design system is built for the high-stakes world of finance, where clarity is a form of luxury and precision is the ultimate sign of respect for the user. Our **Creative North Star** is **"The Digital Curator."** 

We are moving away from the "template" look of traditional fintech apps. Instead of rigid, boxed grids and heavy borders, this system utilizes an editorial layout style. We embrace intentional asymmetry, allowing heavy-weight typography to anchor the eye while negative space directs the flow. The experience should feel less like a software tool and more like a bespoke, high-end financial broadsheet—authoritative, quiet, and exceptionally fast.

---

## 2. Colors: Tonal Authority
Our palette is anchored in deep navies and crisp whites, punctuated by sophisticated brass and slate tones. We do not use color to decorate; we use it to communicate hierarchy and state.

### Core Token Implementation
*   **Primary (`#001736`) & Primary Container (`#002b5c`):** These represent the foundation of the brand. Use these for high-level navigation and primary action states.
*   **Surface Hierarchy:** Our "Background" is not a single color—it is a landscape.
    *   **Base:** `surface` (#f8f9fa)
    *   **Sub-sections:** `surface_container_low` (#f3f4f5)
    *   **Floating Cards:** `surface_container_lowest` (#ffffff)

### The "No-Line" Rule
**Explicit Instruction:** You are prohibited from using 1px solid borders to define sections or separate content. 
*   **How to separate:** Transition from a `surface` background to a `surface_container_low` section. The change in tone is enough to define the boundary without creating visual "noise."

### The "Glass & Gradient" Rule
To elevate the UI beyond standard Material 3, apply these signature styles:
*   **Signature Textures:** For primary CTAs and hero headers, use a subtle linear gradient (45°) transitioning from `primary` (#001736) to `primary_container` (#002b5c). This adds a "silk" finish that flat color lacks.
*   **Glassmorphism:** For floating modals or navigation bars, use `surface_container_lowest` at 80% opacity with a `backdrop-blur` of 20px. This creates a sense of physical layering and sophisticated depth.

---

## 3. Typography: Editorial Precision
We use **Inter** for its mathematical clarity and neutrality. In this system, typography is the primary "UI element."

*   **Display (lg/md/sm):** Reserved for large financial totals or high-level account summaries. These should be set with tight letter-spacing (-0.02em) to feel "heavy" and authoritative.
*   **Headline & Title:** Use `headline-sm` or `title-lg` for section headers. Always pair these with significant vertical whitespace above them to create an "editorial" breathing room.
*   **Body & Labels:** Use `body-md` for standard text and `label-md` for technical data points (e.g., "Market Cap"). Use `on_surface_variant` (#43474f) to secondary information to keep the focus on the primary numbers.

---

## 4. Elevation & Depth: The Layering Principle
Depth in this system is achieved through light and material properties, not artificial shadows.

*   **Tonal Layering:** Always stack "Up." 
    1.  Background: `surface`
    2.  Section: `surface_container_low`
    3.  Card/Component: `surface_container_lowest`
*   **Ambient Shadows:** If an element must float (like a FAB or a temporary modal), use a shadow with a blur radius of 32px and an opacity of 6%. The shadow color must be a tint of `primary` (#001736) rather than pure black to maintain the "Navy" atmosphere.
*   **The Ghost Border:** If a boundary is strictly required for accessibility, use a "Ghost Border": the `outline_variant` (#c4c6d0) at 15% opacity. It should be felt, not seen.

---

## 5. Components

### Buttons
*   **Primary:** High-gloss gradient (Primary to Primary Container). Roundedness: `md` (0.375rem).
*   **Secondary:** Ghost style. No background, `outline` token at 20% opacity. 
*   **Tertiary:** Pure text-link style using `primary` color, bolded.

### Cards & Lists
*   **Rule:** Forbid the use of divider lines. 
*   **Execution:** Use 16px or 24px of vertical whitespace to separate list items. For cards, use `surface_container_lowest` on top of `surface_container_low`. 
*   **Hover State:** Transition the background to `surface_bright` or increase the "Ghost Border" opacity to 40%.

### Input Fields
*   **Style:** Minimalist. No solid box. Use a 2px bottom-border only, using `outline_variant`. On focus, transition the border to `primary` and lift the label using `label-sm` typography.

### Specialized Financial Components
*   **The Trend Line:** For data viz, use `tertiary_fixed` (#ffddb2) for neutral trends and `primary` for positive growth. Avoid high-vibrancy "neon" greens; stick to the sophisticated palette.
*   **The Market Pulse Header:** A wide-format header using `display-md` typography that overlaps two different surface containers (e.g., half on `primary_container`, half on `surface`).

---

## 6. Do's and Don'ts

### Do
*   **Do** use asymmetrical margins. For example, a wider left margin for navigation and a tighter right margin for data tables creates a high-end magazine feel.
*   **Do** use `surface_tint` (#3f5f92) at very low opacities (2-4%) as an overlay for empty states to give them a "holographic" quality.
*   **Do** prioritize white space over data density. If a screen feels crowded, remove a border and add 8px of padding.

### Don't
*   **Don't** use pure black (#000000) for text. Always use `on_surface` (#191c1d).
*   **Don't** use "Drop Shadows" from a standard UI kit. Only use the Ambient Shadow specification provided in Section 4.
*   **Don't** use standard 1px dividers. They create "visual stutter" and cheapen the premium feel of the navy-white contrast.