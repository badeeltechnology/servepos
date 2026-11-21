---
title: Serve POS guide
description: Set up Serve POS on ERPNext and run a restaurant with it, step by step.
order: 0
---

# Serve POS guide

Serve POS is a restaurant point of sale built on ERPNext. It has five parts, and all of them work on one ERPNext site:

| Part | Who uses it | Where it runs |
|---|---|---|
| **Serve POS app for ERPNext** | Everyone, behind the scenes | Installed on your ERPNext site |
| **Manager app** at `/manage` | Owners, managers, storekeepers | Any browser |
| **Desktop POS** | Cashiers and supervisors | Windows, macOS or Linux, at the counter |
| **Waiter app** | Waiters | Android and iPhone |
| **Guest menu** at `/call-waiter` | Guests | The guest's phone, from the table QR code |

Every sale becomes a normal ERPNext Sales Invoice, so stock, accounts and every ERPNext report keep working as they always do.

## Follow these pages in order

The first five pages take you from nothing to a first sale. Do them in order: each one needs the one before it.

1. [Install ERPNext and Serve POS](install.md)
2. [Set up an outlet in ERPNext](outlet-setup.md): branch, warehouse, walk-in customer, payments and the POS Profile
3. [Users and roles](users.md): who signs in where, and the POS user with its API key
4. [Your menu](menu.md): categories, items, prices, Arabic names, modifiers, tables
5. [Install and connect the desktop POS](desktop-pos.md): its admin account, the API key from ERPNext, then the outlet; then your first sale

Then set up what your restaurant needs:

- [Printers](printers.md): receipt and kitchen printers, and which printer gets which ticket
- [Receipt and ticket layout](print-format.md): your name, VAT number, Arabic, paper size, copies
- [Kitchen](kitchen.md): kitchen tickets, the kitchen screen and preparation slips
- [Waiter app and guest QR](waiter-app.md)
- [Recipes and food cost](recipes.md)
- [Stock orders](stock-orders.md) between your store, kitchens and outlets
- [Reports](reports.md)
- [Troubleshooting](troubleshooting.md)
- [For developers](developers.md)

## A quick checklist

Use this to see what is left. Each line links to the page that explains it.

- [ ] ERPNext is installed and its setup wizard is finished ([install](install.md))
- [ ] Serve POS is installed on the site ([install](install.md))
- [ ] A Branch for each outlet ([outlet setup](outlet-setup.md#2-add-a-branch-for-the-outlet))
- [ ] A warehouse for each outlet, recommended ([outlet setup](outlet-setup.md#3-add-a-warehouse-for-the-outlet))
- [ ] A walk-in customer ([outlet setup](outlet-setup.md#4-add-a-walk-in-customer))
- [ ] An account on each payment method ([outlet setup](outlet-setup.md#5-check-the-payment-methods))
- [ ] A POS Profile for each outlet ([outlet setup](outlet-setup.md#7-create-the-pos-profile))
- [ ] A POS user with an API key ([users](users.md#the-pos-user-and-its-api-key))
- [ ] Menu categories and items ([menu](menu.md))
- [ ] The desktop POS connected, with a supervisor PIN ([desktop POS](desktop-pos.md))
- [ ] Printers added and routed, and a test page printed ([printers](printers.md))
- [ ] Receipt header and footer filled in ([print format](print-format.md))
