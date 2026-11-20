---
title: Install ERPNext and Serve POS
description: Get an ERPNext site, finish its setup wizard, then add the Serve POS app.
order: 1
---

# Install ERPNext and Serve POS

Serve POS is a Frappe app. It runs inside an ERPNext site, so you need ERPNext first.

## What you need

- **ERPNext version 16** on Frappe Framework version 16.
- A computer at each counter for the desktop POS (Windows 10 or 11, macOS, or Linux).
- Android phones or iPhones for waiters, if you use the waiter app.
- Receipt printers and kitchen printers, if you print.

## 1. Get an ERPNext site

Pick one of these. If you are not sure, Frappe Cloud is the easiest.

| Option | Good for | How |
|---|---|---|
| **Frappe Cloud** | Most restaurants. No server to look after. | Sign up at [frappecloud.com](https://frappecloud.com), create a site and choose ERPNext. |
| **Your own server** | Teams with someone who looks after Linux servers | Follow the Frappe guide to [install bench](https://docs.frappe.io/framework/user/en/installation), then `bench get-app erpnext` and `bench new-site`. |
| **Docker** | Trying it on your own computer | Use [frappe_docker](https://github.com/frappe/frappe_docker). |

The ERPNext documentation is at [docs.frappe.io/erpnext](https://docs.frappe.io/erpnext). The Frappe Framework documentation is at [docs.frappe.io/framework](https://docs.frappe.io/framework).

## 2. Finish the ERPNext setup wizard

Open your site in a browser and sign in as Administrator. ERPNext asks a few questions the first time:

- **Country, time zone and currency**: for example Qatar, Asia/Qatar and QAR. The currency decides how many decimals Serve POS shows (2 for QAR, 3 for OMR, KWD and BHD).
- **Company name and abbreviation**: for example *Sample Restaurants* and *SR*. ERPNext adds the abbreviation to warehouse and account names, such as *Stores - SR*.
- **Financial year** and **chart of accounts**: the standard chart is fine to start with.

When the wizard finishes, ERPNext has your company, a chart of accounts, a few warehouses, and the Cash and Credit Card payment methods.

## 3. Install Serve POS

### On Frappe Cloud

Serve POS is being submitted to the [Frappe Cloud Marketplace](https://frappecloud.com/marketplace). Once it is listed, open your site in the Frappe Cloud dashboard, go to **Apps**, choose **Install App** and pick **Serve POS**. Frappe Cloud installs it and runs the migration for you.

Until then, on a Frappe Cloud private bench you can add it as a custom app from its GitHub address.

### On your own server

From your bench folder:

```bash
bench get-app https://github.com/badeeltechnology/servepos
bench --site your.site install-app servepos
bench --site your.site migrate
bench restart
```

Replace `your.site` with your site name.

## What the install adds

You do not need to do anything for these. The install creates them, and creates any that are missing again each time you migrate.

- **Roles**: ServePOS Manager, ServePOS Reporter, ServePOS Supervisor, ServePOS Cashier, ServePOS Waiter, ServePOS Kitchen, ServePOS Outlet User, ServePOS CK Provider and ServePOS Pastry Provider. See [Users and roles](users.md).
- **A Branch accounting dimension**, if the site does not have one yet. This puts a **Branch** field on POS Profiles, Sales Invoices, Stock Entries and the General Ledger, so each outlet gets its own sales and profit and loss. See [Set up an outlet](outlet-setup.md).
- **Fields** on Item, Item Group, POS Profile, Sales Invoice and Stock Entry: Arabic names, menu settings, kitchen and guest settings, and the POS order number.
- **Print formats** for kitchen tickets and bills in ERPNext.
- **Settings pages** for stock orders, day close, translation and the mobile apps.

## 4. Open the manager app

Go to `https://your.site/manage`. Signed in as Administrator, you see every screen. This is where managers look after the menu, tables, waiters, offers, recipes, stock and reports.

The menu items are empty until you add them. That comes after the outlet setup, because each item is switched on per outlet.

**Next:** [Set up an outlet in ERPNext](outlet-setup.md)
