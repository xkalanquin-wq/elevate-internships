# From website to app

How Elevate Internships becomes an installable phone app, and what carries over unchanged. Written after the 2026 remodel, which built the interface mobile-first for this purpose.

## Recommended path

### 1. Progressive web app (done)

The site already installs as an app on Android, iOS and desktop:

- A manifest with icons, standalone display and shortcuts (`client/public/site.webmanifest`).
- A service worker for the offline page, cached assets and web push (`client/public/sw.js`).
- The Install app button (`client/src/InstallApp.jsx`).

Once installed, it opens full screen with the bottom tab bar, honours the phone's safe areas (notch and home indicator), and receives notifications on Android and desktop. On iOS 16.4 and later, web push works from the home-screen app.

This covers most of what a store app would do, at no extra cost.

### 2. Capacitor (next, for the App Store and Google Play)

[Capacitor](https://capacitorjs.com) wraps the existing Vite build in native iOS and Android shells. It fits this stack: the app is React on the web, and Capacitor runs that same web app inside a native WebView. Nothing is rewritten.

Steps when the time comes:

1. Install the packages: `npm i @capacitor/core @capacitor/ios @capacitor/android` and `npm i -D @capacitor/cli`. Ask before adding them; they are new dependencies.
2. `npx cap init "Elevate Internships" com.elevateinternships.app --web-dir dist`.
3. `npm run build && npx cap add ios && npx cap add android`, then `npx cap sync` after every build.
4. Point the API at the live server. The app's pages load from inside the app, so `client/src/api.js` needs an absolute base URL (`https://elevateinternships.com`) instead of relative `/api/…` paths.
5. Sign-in. The web app uses an HttpOnly session cookie. Inside Capacitor, enable the CapacitorHttp plugin so native requests carry cookies, or switch to a token for the app build. Either option touches auth, so it needs its own review.
6. Push notifications. The server sends Web Push (VAPID). Native apps need APNs (iOS) and FCM (Android) through `@capacitor/push-notifications`, which means a server change to send to those services as well.
7. Files and links:
   - **Calendar and exports:** the .ics calendar files and the data exports currently download through the browser. In the app they go through `@capacitor/share` or `@capacitor/filesystem`.
   - **External links:** links that open other sites (Apply ↗, certification pages) use `@capacitor/browser`.

### Why not React Native or Expo

React Native renders native views, not HTML and CSS. Every screen, the stylesheets and the server-rendered guide pages would have to be rebuilt. Only the data layer would carry over. That makes sense only if the app later needs deep native features the WebView cannot provide.

## What carries over as-is

### Design tokens

- `client/src/tokens.css` holds every color, type size, space, corner, shadow, control size and layout value.
- `tailwind.config.js` maps the same tokens for the /home page.
- In a Capacitor app they work unchanged. A React Native rewrite would copy the values into a theme object.

### Presentational components

These are in `client/src/components/ui/`. They take data and callbacks as props, and fetch nothing themselves:

| Component | What it is | In a native shell |
|---|---|---|
| `PrimaryNav` | The four sections plus More: a bottom tab bar on phones, top navigation from 768px | Unchanged in Capacitor; a tab navigator in React Native |
| `MoreSheet` | Account, theme, font settings, feedback and site pages in a bottom sheet (a centered panel on wider screens) | Unchanged; a native action sheet in React Native |
| `AccountControls` | Sign in or out, account link, theme button | Unchanged |
| `PageLinks` | The site's other pages, as pills or a list | Unchanged |
| `EmptyState` | "Nothing here yet" and error cards | Unchanged |
| `Icon` | The inline SVG icon set | Unchanged; react-native-svg in React Native |
| `ui.css` | Shell layout, mobile first, with safe-area insets | Unchanged |

### Logic layer (no DOM rendering)

| File | What it does | Notes for an app |
|---|---|---|
| `client/src/api.js` | Every call to the server | Needs an absolute base URL (step 4) |
| `client/src/guestStore.js` | Ledger and tracker for people without an account | Uses localStorage; `@capacitor/preferences` if storage must survive the OS clearing WebView data |
| `client/src/validate.js` | ZIP, major and interest rules | As-is |
| `client/src/calendar.js` | Builds .ics files for deadlines and interviews | Building is as-is; saving goes through Share or Filesystem |
| `client/src/referral.js` | Remembers a ?ref= code for 30 days | As-is |
| `client/src/consent.js` | Google Fonts consent | Bundle the fonts in the app and drop the consent step |
| `client/src/errors.js` | Reports browser errors to the server | As-is |
| `client/src/install.js` | Install prompt and service worker | Not needed inside a store app |

The server (`server/`) does not change for a Capacitor app, apart from steps 5 and 6.

### Not reusable as-is

- **`client/src/App.jsx`** holds the app's state and routing together with the screen layout. A later refactor could move the state into hooks (`useLedger`, `useTracker`, `useAccount`), so a React Native build could reuse them. Capacitor doesn't need this.
- **The server-rendered guide pages** (`server/content.js`): Internships by major, Career guides, Interview questions, Premium, Sponsor and How it works. In an app they open from the live site in the in-app browser, which keeps them current and indexed by search engines.

## Motion

### How it's built

All motion goes through `client/src/motion/` and `client/src/motion.css`, using the tokens in `tokens.css`:

- **Durations:** fast 120ms, base 200ms, slow 400ms.
- **Curves:** a standard ease-out and a springy one.
- **Distances and stagger:** fixed steps, also tokens.

The token `--motion-on` is the single switch. It's 0 when the device asks for reduced motion (or when `<html data-motion="reduce">` is set), which makes every duration and distance 0. The loops stop, and nothing waits to appear.

Rules for every effect:

- Movement animates only `transform` and `opacity`. State changes on controls may also fade a color.
- Nothing is hover-only: each hover effect has a press or focus equivalent.
- Nothing hijacks scrolling, and there's no parallax.
- Content never waits more than 400ms.
- The only continuous loops are the hero background and the empty-state drawings, and both pause off screen. Loading placeholders and a busy button's spinner also loop, but only while something is loading.

### Wrappers and their native equivalents

Inside Capacitor, every wrapper works unchanged. The last column is the swap for a React Native build.

| Wrapper | What it does | React Native equivalent |
|---|---|---|
| `tokens.js` (`durationMs`, `easing`, `reducedMotion`) | Reads motion tokens for script animations | A theme object; `AccessibilityInfo.isReduceMotionEnabled()` |
| `useReducedMotion` | Follows the reduced-motion setting live | `useReducedMotion()` from react-native-reanimated |
| `useInView` | Element entered or left the screen | `onViewableItemsChanged` on FlatList, or a measure on scroll |
| `Reveal`, `Stagger` | Fade up once on first view; lists one item after another | Reanimated `entering={FadeInDown.delay(i * step)}` |
| `PageTransition` | Fade and slight rise when the screen changes | The navigator's screen transition (react-navigation `animation: 'fade_from_bottom'`) |
| `usePresence` | Keeps a sheet mounted while it animates out | Reanimated `exiting` animations |
| `FlipList` | Filtered or sorted lists glide to their new order | Reanimated `layout={LinearTransition}` |
| `AnimatedNumber` | Totals count up when they come into view | `useSharedValue` + `withTiming`, rendered with `ReText` |
| `TabIndicator` | The marker that slides to the active tab | The tab navigator's indicator, or an animated `translateX` |
| `AnimatedBackdrop` | Slow drift of palette tints behind the heading | Two `Animated.View`s with looping `withRepeat(withTiming(...))` |
| `Skeleton` | Loading placeholders shaped like the result | `react-native-skeleton-placeholder` or an opacity loop |
| `Illustration` | Empty-state drawings with a gentle float | react-native-svg with a looping `translateY` |
| `useCelebrate` | The ring when a certification is completed | A short Reanimated scale and opacity sequence |
| `motion.js` (ripple, confetti) | Press ripple; confetti for an application sent or an offer | `android_ripple` on Pressable; `react-native-confetti-cannon` |

## Already in place for a phone

- **Layout:** mobile-first from 375px, with tablet (768px) and desktop (1024px) layouts added on top.
- **Navigation:** a bottom tab bar on phones and top navigation from 768px. Both are the same component, so the tab order and keyboard support are identical.
- **Touch:** every button, link, field, chip and checkbox is at least 44×44px.
- **Safe areas:** the top bar, tab bar, More sheet and consent banner respect `env(safe-area-inset-*)`.
- **No hover-only features:** hover styles are wrapped in `@media (hover: hover)` and are only a visual extra. Everything works by tap.
- **Theme:** light and dark themes follow the system or the person's choice, with the same contrast-checked palette.
