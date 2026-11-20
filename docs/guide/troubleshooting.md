---
title: Troubleshooting
description: The POS cannot connect, sales fail to sync, nothing prints, Arabic or items do not show.
order: 13
---

# Troubleshooting

## The POS cannot connect

At first-time setup, **Verify Connection** fails, or the status bar shows **ERPNext** in red.

| Check | How |
|---|---|
| The address | Open it in a browser on the same computer. It must start with `https://` and have no path after the site name. |
| The internet | Can the computer open other websites? |
| The API key and secret | In ERPNext, open the POS user › **Settings** › **API Access**. If unsure, click **Generate Keys** again and type the new secret into the POS (**Supervisor tools** › **System** › **Edit Connection**). |
| The user is enabled | The POS user must be **Enabled** in ERPNext |
| The roles | The POS user needs **ServePOS Cashier** and **Accounts User** ([Users and roles](users.md#2-give-it-two-roles)). Without Accounts User, the POS cannot read the POS Profile. |

The POS keeps selling while it cannot connect. Sales wait and go up when the connection is back.

## Sales fail to sync

The status bar shows **failed to sync**. A supervisor opens **Settings** › **Sync** to see each failed sale and ERPNext's reason. The usual causes:

| ERPNext says | Fix |
|---|---|
| A payment method has no default account | Add the company's account to that **Mode of Payment** ([outlet setup](outlet-setup.md#5-check-the-payment-methods)) |
| The customer does not exist | Create the walk-in customer and set it on the POS Profile ([outlet setup](outlet-setup.md#4-add-a-walk-in-customer)) |
| Not enough stock in the warehouse | The menu item is a stock item. Menu items should not be stock items: untick **Maintain Stock** on the item, or let [recipes](recipes.md) take ingredients out at day close. Or allow negative stock in **Stock Settings**. |
| The posting date is in a closed period | Reopen the period in ERPNext, or post with a date in an open period |
| Insufficient permission | The POS user is missing **Accounts User** |

Fix the cause in ERPNext, then click **Sync now**. The POS sends the sale again; it checks the order number first, so a sale is never posted twice.

## Nothing prints

1. **Test** the printer in **Settings** › **Printers**. If the test page prints, the printer is fine: check the [routes](printers.md#2-route-the-printing). Receipts need a **Receipt** route, kitchen tickets a **KOT** route.
2. If the test fails on a **network** printer:
   - Print the printer's self-test page and check its IP address is the one in the POS.
   - From the POS computer, `ping` the address. No reply: the printer and computer are on different networks, or the address changed. Give the printer a fixed address ([Printers](printers.md#before-you-start-give-network-printers-a-fixed-address)).
   - Check the port is `9100`.
3. If the test fails on a **USB** printer:
   - Check it is in **Printers & scanners** in Windows and prints a Windows test page.
   - The **Printer Name** in the POS must match the Windows name exactly. Use **Detect Printers** to pick it.
4. Paper out, cover open or a red light: the POS keeps the ticket and shows **Retry**.

## A kitchen gets the wrong items

Kitchen tickets follow the KOT routes by menu category ([Printers](printers.md#send-each-kitchen-its-own-items)). An item goes to the catch-all route if its category has no route of its own. Check the item's category in the manager app, and the routes on each POS.

## Arabic prints as boxes or question marks

The POS prints Arabic as an image, so this should not happen with the current version. Update the POS (**Settings** › **Updates**). Check the item has a **Name in Arabic** and **Show Arabic item names** is ticked in [Print Format](print-format.md#receipt-options).

## An item does not show on the POS

- Its category must be a menu category ([Your menu](menu.md#categories)).
- It must be sold at this outlet: **Where it is sold** on the item.
- It must not be **Sold out** or **Disabled**.
- Wait for the next sync, or click **Sync now** on the POS.

## Amounts show the wrong number of decimals

The POS: **Supervisor tools** › **Print Format** › **Currency** › **Decimals**. The manager app: ERPNext **System Settings** › **Currency Precision**, or leave it empty to use the currency's own (3 for OMR, KWD and BHD).

## A supervisor forgot their PIN

Another supervisor, or the POS admin in **Supervisor tools** › **Supervisor**, uses **Reset PIN**.

## Getting help

Ask on [GitHub](https://github.com/badeeltechnology/servepos/issues), or ask [Badeel Technology](https://badeeltechnology.com/contact) to set it up or support it for you.
