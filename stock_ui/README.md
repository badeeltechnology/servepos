# Stock Orders UI

Vue 3 + frappe-ui 1.0 app served by the servepos app at `/stock`.

```bash
cd apps/servepos/stock_ui
npm install
npm run build      # writes ../servepos/public/stock (committed, so sites need no node build)
```

Screens: outlet Today / New order / Receive / Transfers / Returns / Inventory / History,
provider Picking sheet / To ship / Discrepancies, procurement To buy, management Reports.
API: `servepos/stock_orders/api.py`; PDF and Excel: `servepos/stock_orders/exports.py`.
End-to-end check (rolls back): `/api/method/servepos.stock_orders.test_flow.run` as System Manager.
