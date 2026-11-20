---
title: For developers
description: The three repositories, how they talk to each other, and how to run each one for development.
order: 14
---

# For developers

Serve POS is three open-source projects that share one ERPNext site.

| Repository | What it is | Built with |
|---|---|---|
| [servepos](https://github.com/badeeltechnology/servepos) | The Frappe app: doctypes, the API the POS and apps call, the manager app at `/manage`, the guest menu at `/call-waiter` | Python, Frappe, Vue 3, frappe-ui |
| [servepos-desktop](https://github.com/badeeltechnology/servepos-desktop) | The desktop POS | Electron, React, SQLite |
| [waiterapp](https://github.com/badeeltechnology/waiterapp) | The waiter app | Flutter |

## How they talk

- The **desktop POS** signs in with an ERPNext API key. It reads the menu through whitelisted methods in `servepos.api.registry` (`get_pos_bundle` returns everything a POS needs) and posts each sale as a standard **Sales Invoice** through the REST API, with `is_pos`, `update_stock` and the POS Profile. Each invoice carries `servepos_order_number`; the POS looks it up before posting, so a retried sale never posts twice.
- The **waiter app** signs in as a user with the **ServePOS Waiter** role and uses `servepos.api.mobile`.
- The **guest menu** uses `servepos.api.guest`, with a short-lived token per table.
- The **manager app** is a Vue app served by the Frappe app, using `servepos.api.manager`, `servepos.api.admin` and the recipe and stock modules.

Nothing is stored outside ERPNext except the POS's own SQLite database, which holds the menu copy, orders before they post, printers and the POS's staff PINs.

## Run the Frappe app

```bash
bench get-app https://github.com/badeeltechnology/servepos
bench --site dev.localhost install-app servepos
bench --site dev.localhost migrate
```

The manager app's source is in `stock_ui/`:

```bash
cd apps/servepos/stock_ui
npm install
npx vite build
```

## Run the desktop POS

```bash
git clone https://github.com/badeeltechnology/servepos-desktop
cd servepos-desktop
npm install
npm run dev
```

To work on the screens without Electron or a server, run the browser preview with sample data:

```bash
npx vite --config vite.renderer.dev.config.ts --port 5199
```

Open `http://localhost:5199`. Options such as `?setup=1` (first-time setup) or `?currency=OMR` are listed at the top of `src/renderer/src/dev/mockApi.ts`.

## Run the waiter app

```bash
git clone https://github.com/badeeltechnology/waiterapp
cd waiterapp
flutter pub get
flutter run
```

## Contributing

Issues and pull requests are welcome on each repository. Places where help matters most:

- Printers and cash drawers we have not tried
- Languages beyond English and Arabic
- Offline sync and its tests
- This guide
