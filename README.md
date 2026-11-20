### Servepos

An intuitive POS solution built for restaurants to handle orders, payments, and kitchen coordination seamlessly.

### Guide

The [Serve POS guide](docs/guide/index.md) takes you from a fresh ERPNext site to the first sale: the outlet's POS Profile, the branch dimension, users and API keys, the menu, the desktop POS, printers and receipt layout, the waiter app, recipes, stock orders and reports.

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
