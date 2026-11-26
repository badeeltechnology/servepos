### Servepos

An intuitive POS solution built for restaurants to handle orders, payments, and kitchen coordination seamlessly.

### Download the apps

| App | Download |
|---|---|
| Desktop POS for **Windows** | [Download](https://github.com/badeeltechnology/servepos-releases/releases/download/v2.19.3/servepos-desktop-2.19.3-setup.exe) |
| Desktop POS for **macOS** (Apple silicon) | [Download](https://github.com/badeeltechnology/servepos-releases/releases/download/v2.19.3/ServePOS-2.19.3-arm64-mac.zip) |
| Waiter app for **Android** | [Download the APK](https://github.com/badeeltechnology/waiterapp/releases/latest/download/ServePOS-Waiter.apk) |

Source: [servepos-desktop](https://github.com/badeeltechnology/servepos-desktop) and [waiterapp](https://github.com/badeeltechnology/waiterapp).

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch version-16
bench install-app servepos
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/servepos
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

agpl-3.0
