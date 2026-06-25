# Modern UI Redesign Design

## Context

The app is a React Native and Expo mobile management tool for 3D printing operations. The UI is
implemented across `screens/`, `components/`, `navigation/`, and `constants/index.js`.

The current interface uses basic iOS-style colors, heavy blue headers, simple cards, and repeated
per-screen styling. It works functionally, but it feels closer to an early MVP than a modern
operations app. Several source files also show mojibake in terminal output. The redesign should
improve the visible app experience while avoiding broad unrelated text rewrites.

## Goal

Redraw the full app UI so it feels more modern, consistent, and suitable for daily management work.
The approved direction is:

- Primary style: professional operations dashboard.
- Secondary accent: stronger model-gallery treatment on model screens.

The result should make orders, inventory, model assets, forms, and settings easier to scan and use.

## Non-Goals

- Do not redesign backend APIs or data shapes.
- Do not change auth, upload, import/export, or inventory business behavior.
- Do not add new design or UI dependencies unless an existing Expo dependency cannot cover the
  need.
- Do not perform a broad copywriting rewrite outside user-visible labels touched by the redesign.
- Do not turn the app into a marketing landing page or a decorative showcase.

## Design Direction

Use a calm, high-density admin style:

- Light neutral app background.
- White or near-white surfaces with subtle borders and low shadows.
- Blue-teal primary accent for commands and selected states.
- Distinct semantic colors for success, warning, danger, info, and muted states.
- Compact typography scale for operational screens.
- Fixed-size icon buttons and controls to prevent layout shift.
- Cards used for repeated list items and form sections, not for every page band.

The model area should feel more visual than the rest of the app:

- Preview image areas should be stable and prominent.
- Empty model previews should use a restrained icon placeholder.
- Grid/list mode should both look intentional.
- File and image counts should be presented as compact metadata.

## Design Tokens

Extend `constants/index.js` beyond the current flat `COLORS` object. Keep existing color keys for
compatibility, but add modern tokens for new work:

```text
COLORS
- primary
- primaryDark
- primarySoft
- accent
- background
- surface
- surfaceElevated
- surfaceMuted
- text
- textSecondary
- textTertiary
- border
- borderStrong
- success
- successSoft
- warning
- warningSoft
- danger
- dangerSoft
- info
- infoSoft
```

Add reusable primitive constants in the same file:

```text
SPACING
- xs, sm, md, lg, xl, xxl

RADIUS
- sm, md, lg, xl, pill

TYPOGRAPHY
- screenTitle
- sectionTitle
- body
- meta
- caption

SHADOWS
- card
- floating
```

Implementation can keep these as plain JavaScript objects so existing imports remain simple.

## Component Redesign

### Card

`Card` becomes the shared surface primitive:

- Default background `surfaceElevated`.
- Border instead of heavy shadow on most platforms.
- Radius no larger than 8 unless used by modal sheets.
- Optional `variant` values: `default`, `muted`, `interactive`, `section`.
- Optional `padding` values for dense lists and form sections.

### Button

`Button` should support modern command hierarchy:

- `primary`: filled primary button.
- `secondary`: subtle filled button.
- `outline`: bordered button.
- `ghost`: text/icon command without a filled background.
- `danger`: destructive filled button.

Support optional `iconLeft` and `iconRight` Ionicon names. Existing `title`, `variant`, `size`,
`loading`, and `disabled` props remain compatible.

### Input

`Input` should look like a production form control:

- Slightly taller touch target.
- Softer placeholder.
- Clear focused and error borders.
- Dense label styling.
- Stable multiline behavior.

### Picker

`Picker` should align with `Input` styling and keep the modal sheet. The sheet should use a modern
rounded top and clear selected state. The trigger should not resize when values change.

### Badge

`Badge` should use softer status backgrounds by default, not saturated filled pills for every state.
It should still support filled and outline variants for compatibility.

## Navigation Redesign

### Bottom Tabs

`TabNavigator` should become visually lighter:

- White or elevated tab bar on the neutral app background.
- Stronger selected icon/text treatment using primary color.
- Muted inactive states.
- Subtle top border and platform-appropriate shadow.
- Consistent labels for Home, Orders, Models, Materials, and Settings.

### Stack Headers

`AppNavigator` should replace heavy blue stack headers with a neutral operational header:

- Light surface background.
- Dark text title.
- Primary-colored back/action affordances.
- Subtle bottom border.

This should make detail and form screens feel part of the same system as the tab screens.

## Screen Redesign

### Login

Make login feel like a polished app entry:

- Neutral background with a compact brand block.
- Form panel with modern inputs and segmented login/register switch.
- Primary submit button.
- Default credential hint kept visible but visually quiet.

### Home

Redraw as the operational dashboard:

- Top summary area with app name, short operational subtitle, and refresh/export affordance where
  appropriate.
- Three key metric cards: pending review, in progress, low stock.
- Quick action grid with stable icon buttons.
- Recent orders list with compact rows and clear chevrons.
- Loading states should preserve layout size where practical.

### Orders

Redraw as a dense order work queue:

- Header row with title, search, filter, and create actions.
- Search field as a modern inline tool surface.
- Status filter as segmented chips instead of a bulky modal-first experience.
- Order cards with customer, order id, status, total, due date, created date, and item preview.
- Delete action as a small icon button with enough spacing from card navigation.

### Models

Redraw as the visual asset library:

- Header actions for view mode, search, source filter, and create.
- Search and active filter hints styled as tool surfaces.
- List mode: thumbnail on the left, content on the right.
- Grid mode: larger preview area, name, source badge, metadata.
- Floating create action can remain if it does not overlap content.
- Empty state should use a model icon, short text, and primary create action.

### Materials

Redraw as inventory management:

- Header with search and create actions.
- Tabs for materials and inventory as segmented controls.
- Inventory action panel for inbound, outbound, and adjustment as compact command buttons.
- Material cards emphasize material type, brand, color, diameter, total quantity, and lot count.
- Lot cards emphasize lot number, serial number, material label, quantity, status, and date.

### Detail Screens

`OrderDetailScreen`, `ModelDetailScreen`, and `MaterialDetailScreen` should share a detail-page
language:

- Top identity section with title and status/source badge.
- Metadata groups arranged as compact rows.
- Section cards for customer, items, files, images, stock lots, and actions.
- Destructive actions separated visually from normal actions.
- Back/error/empty states should be consistent.

### Form and Transaction Screens

`CreateOrderScreen`, `CreateModelScreen`, `CreateMaterialScreen`, `InboundTransactionScreen`,
`OutboundTransactionScreen`, `AdjustTransactionScreen`, `DataImportScreen`, and `OSSConfigScreen`
should share form structure:

- Neutral background.
- Form sections using redesigned `Card`.
- Dense section headings.
- Inputs and pickers with consistent spacing.
- Primary submit button and secondary cancel/back button.
- File upload buttons with icons.
- Validation and loading states should stay compatible with current behavior.

### Settings

Settings should be a quiet utility screen:

- Account/system sections with modern list rows.
- Data import and OSS config as clear navigable commands.
- Sign-out/destructive commands separated at the bottom.

## User-Visible Text

Where redesign work touches visible labels, replace mojibake with correct user-facing Chinese text.
Do not attempt a broad mechanical encoding conversion unless implementation confirms the source
files are actually corrupted and the change is necessary for the UI to render correctly.

## Error, Empty, and Loading States

All main screens should have consistent states:

- Loading: centered spinner and short text, or preserved skeleton-like layout when already present.
- Empty: icon, concise explanation, and a next action when useful.
- Error: keep existing alerts, but visible inline fallback areas should use the new visual system.
- Disabled/loading buttons: preserve size and use clear opacity or spinner treatment.

## Accessibility and Responsiveness

- Maintain minimum practical touch targets around 44 px.
- Text must not overlap icons or controls on narrow mobile widths.
- Long labels should use `numberOfLines` or flexible layout rather than pushing controls off-screen.
- Keep web compatibility because the app has a `web` script.
- Do not use viewport-scaled font sizes.

## Implementation Approach

1. Update design tokens in `constants/index.js`.
2. Redesign shared components: `Card`, `Button`, `Input`, `Picker`, and `Badge`.
3. Update navigation visual styling.
4. Redraw tab-level screens: Login, Home, Orders, Models, Materials, Settings.
5. Redraw detail screens.
6. Redraw form and transaction screens.
7. Run static validation and launch Expo web for visual verification where practical.

This order gives the app a coherent system early and reduces repeated screen-level styling.

## Testing and Verification

Minimum verification after implementation:

- `npm`/Metro static parse succeeds by starting the Expo web server.
- The app opens in web mode without a blank screen.
- Login screen renders.
- Main tabs render after auth state permits access, or the available unauthenticated flow is
  visually checked if backend auth is not available.
- Key screens have no obvious overlapping text or controls at mobile and desktop web widths.
- `git diff` confirms business logic/API behavior was not intentionally changed.

Backend verification is not required for visual-only changes unless a frontend change touches API
calls or data handling.

