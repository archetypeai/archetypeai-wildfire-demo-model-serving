# Archetype AI Design System

## Stack

- Svelte 5 with runes (`$props`, `$state`, `$derived`, `$bindable`)
- Tailwind v4 with semantic tokens (`@archetypeai/ds-lib-tokens`)
- shadcn-svelte registry pattern (via `@archetypeai/ds-cli`)
- bits-ui for headless primitives
- layerchart for data visualization

## Commands

- `npx @archetypeai/ds-cli add ds-ui-svelte` - install all components
- `npx shadcn-svelte@latest add <url>` - install individual component

## Tokens

Prefer semantic tokens for themed colors:

- `bg-background`, `text-foreground`, `border-border`
- `bg-primary`, `text-primary-foreground`
- `bg-muted`, `text-muted-foreground`
- `bg-card`, `bg-popover`, `bg-accent`, `bg-destructive`
- `bg-atai-neutral`, `text-atai-good`, `text-atai-warning`, `text-atai-critical`
- etc.

Standard Tailwind is fine for:

- Spacing/sizing: `p-4`, `w-full`, `gap-2`, `h-screen`
- Layout: `flex`, `grid`, `absolute`, `relative`

## CSS Import Order

```css
@import '@archetypeai/ds-lib-tokens/fonts.css';
@import '@archetypeai/ds-lib-tokens/theme.css';
@import 'tailwindcss';
```

## Component Patterns

- **Props**: `let { class: className, ref = $bindable(null), children, ...restProps } = $props();`
- **Classes**: `cn()` from `$lib/utils.js` - never raw concatenation
- **Variants**: `tailwind-variants` (tv) for component variants
- **Slots**: `{@render children?.()}`

## Design system packages

The Archetype AI design system ships as npm packages: `@archetypeai/ds-lib-tokens` (tokens and theme, used here), `@archetypeai/ds-ui-svelte-console` and `@archetypeai/ds-ui-svelte-labs` (Svelte components), with the `@archetypeai/ds-cli` scaffolding CLI. Before building a new component, check whether those packages or `$lib/components/ui/` already have it. The [`atai-design-system`](https://github.com/archetypeai/agent-skills/tree/main/skills/atai-design-system) agent skill covers how to use them.

Fonts: this repo uses Geist and Geist Mono (open source, from `@fontsource-variable`), not the design system's `fonts.css`; see `src/routes/layout.css`.

## Skills

**Skill composition:** When building a demo on the Archetype AI APIs (this app calls Newton C 2.6 on the Inference API; see `src/lib/server/newton.js` and the [Archetype AI agent skills](https://github.com/archetypeai/agent-skills)):

1. Use `@skills/create-dashboard` for the page layout (dashboard with Menubar)
2. Reuse components from the design system packages and `$lib/components/ui/` before creating new ones
3. Apply `@rules/design-principles` aesthetic conventions (BackgroundCard for single-purpose cards, mono font for headers/numbers)
4. Only include chart components if the user's request involves time-series or explicitly mentions charts

Read these when relevant to your task:

- `@skills/apply-ds` - apply DS tokens, components, and patterns to an existing demo
- `@skills/build-pattern` - create composite patterns from primitives
- `@skills/setup-chart` - set up charts with layerchart
- `@skills/create-dashboard` - scaffold a full-viewport dashboard with menubar and panels
- `@skills/fix-accessibility` - audit and fix a11y issues
- `@skills/fix-metadata` - update page titles, favicons, and OG tags
- `@skills/deploy-worker` - deploy SvelteKit projects to Cloudflare Workers

## Rules

See `@rules/` for comprehensive guidance on design principles, components, styling, charts, and linting.

- `@rules/accessibility` — a11y guidelines and ARIA patterns
- `@rules/charts` — chart setup, layerchart conventions, data visualization
- `@rules/components` — component API patterns, props, variants, slots
- `@rules/design-principles` — visual design language, spacing, typography
- `@rules/frontend-architecture` — component decomposition, page composition, API logic extraction
- `@rules/linting` — linting and formatting rules
- `@rules/state` — state management with Svelte 5 runes
- `@rules/styling` — Tailwind v4, semantic tokens, theming
