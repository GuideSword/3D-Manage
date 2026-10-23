# Responsive Xiaoli ERP Web Experience Design

## Goal

Make the existing Expo/React Native Web client feel like the next stage of the Xiaoli app: phones keep the current focused, rounded Xiaoli home experience, while desktop browsers gain an ERP workbench layout for daily 3D-printing operations.

## Scope

- Add a web-only responsive shell around the authenticated tab experience.
- Keep native Android/iOS navigation unchanged.
- Reuse the current `CyberHome`, theme tokens, icons, and Xiaoli artwork rather than introducing a separate visual language.
- Provide desktop navigation for home, orders, models, materials, customers, suppliers, data center, and settings.
- Provide desktop top actions and page framing while preserving existing route transitions.
- Keep the mobile bottom tab bar and mobile page chrome usable at narrow widths.
- Preserve all existing API calls, permissions, loading states, and route names.

## Visual direction

The desktop layout is an expansion of the current Xiaoli app, not an independent ERP theme. It uses the existing purple/lavender gradient, soft glass-like surfaces, rounded cards, status colors, and Xiaoli hero artwork. The desktop shell has a light rail with grouped navigation, a branded welcome hero, KPI cards, trend/queue panels, and tabular recent orders. Mobile retains the current hero and bottom tabs; only spacing and width behavior change.

## Responsive behavior

- At widths below `768px`, render the existing mobile-oriented tab bar and single-column content. Cards may wrap, but no horizontal page scrolling is introduced.
- At widths `768px` and above, use a two-column shell with a persistent left rail and a scrollable content column. The rail collapses to icon-only mode below `1024px` if needed to preserve content width.
- Desktop content is capped at a readable width and remains fluid between breakpoints.
- Use `useWindowDimensions` or a small `useResponsiveLayout` hook; avoid reading `window` during SSR or initial native render.
- The shell must work in light and dark themes. The light visual direction follows the approved mockup; dark mode maps the same surfaces through existing `DARK_COLORS` tokens.

## Component boundaries

- `components/web/ResponsiveAppShell.js`: chooses desktop or mobile shell using the current viewport and exposes the navigation content area.
- `components/web/DesktopSidebar.js`: grouped ERP navigation, active route state, user profile, and collapse behavior.
- `components/web/DesktopTopbar.js`: breadcrumb, search/notification affordances, and permission-aware create action.
- `components/home/CyberHome.js`: remains the data-aware dashboard; its desktop presentation is added through responsive styles and layout props rather than duplicating dashboard data loading.
- `navigation/TabNavigator.js`: owns the five primary routes and selects `CyberTabBar` on mobile and the desktop shell on web/desktop.
- `navigation/CyberTabBar.js`: remains the mobile bottom navigation; it receives width-safe styles and is not shown in the desktop shell.

## Interaction and permissions

- Navigation items call the existing React Navigation routes.
- Create buttons are only rendered when `canWrite(user)` is true.
- Admin-only data/settings links use the existing `canManage`/`canExport` checks.
- The shell does not invent new routes or mutate server data.

## Verification

- Run existing client tests and add focused tests for responsive route selection and desktop-only navigation visibility.
- Export the web bundle with `npx expo export --platform web --output-dir .tmp/responsive-web`.
- Manually verify at narrow mobile width, tablet width, and desktop width in light and dark modes; verify keyboard focus/accessible labels for shell buttons.

