"""
ServePOS FCM (Firebase Cloud Messaging) Utility
Sends push notifications to waiter devices via FCM HTTP v1 API.

Setup:
1. Create a Firebase project at console.firebase.google.com
2. Add your Android app (com.servepos.servepos_waiter)
3. Download the service account JSON key:
   Firebase Console → Project Settings → Service Accounts → Generate new private key
4. In Frappe site_config.json, add:
   {
     "servepos_fcm_credentials_file": "/path/to/service-account-key.json"
   }
   OR set the full JSON inline:
   {
     "servepos_fcm_credentials": { ... service account JSON ... }
   }
"""
import frappe
from frappe import _
import json


def _get_access_token():
    """Get an OAuth2 access token for the FCM HTTP v1 API using the service account."""
    try:
        import google.auth.transport.requests
        import google.oauth2.service_account
    except ImportError:
        frappe.log_error(
            "google-auth package not installed. Run: pip install google-auth",
            "ServePOS FCM"
        )
        return None

    # Try credentials file path first
    creds_file = frappe.conf.get("servepos_fcm_credentials_file")
    creds_json = frappe.conf.get("servepos_fcm_credentials")

    if not creds_file and not creds_json:
        frappe.log_error(
            "FCM not configured. Set servepos_fcm_credentials_file or "
            "servepos_fcm_credentials in site_config.json",
            "ServePOS FCM"
        )
        return None

    try:
        scopes = ["https://www.googleapis.com/auth/firebase.messaging"]

        if creds_file:
            credentials = google.oauth2.service_account.Credentials.from_service_account_file(
                creds_file, scopes=scopes
            )
        else:
            if isinstance(creds_json, str):
                creds_json = json.loads(creds_json)
            credentials = google.oauth2.service_account.Credentials.from_service_account_info(
                creds_json, scopes=scopes
            )

        request = google.auth.transport.requests.Request()
        credentials.refresh(request)
        return credentials.token, credentials.project_id
    except Exception as e:
        frappe.log_error(f"Failed to get FCM access token: {e}", "ServePOS FCM")
        return None


def send_push_to_waiters(pos_profile, call_doc):
    """Send FCM push notification to all active waiters of a restaurant.

    Args:
        pos_profile: POS Profile name (restaurant)
        call_doc: ServePOS Waiter Call document dict with table, name, guest_name
    """
    result = _get_access_token()
    if not result:
        return

    access_token, project_id = result

    # Get table display name
    table_name = frappe.db.get_value(
        "ServePOS Table", call_doc.get("table"), "table_name"
    ) or call_doc.get("table", "Unknown")

    restaurant_name = frappe.db.get_value(
        "POS Profile", pos_profile, "servepos_restaurant_display_name"
    ) or pos_profile

    # Get all active waiters for this profile with FCM tokens
    waiters = frappe.get_all(
        "ServePOS Waiter",
        filters={"is_active": 1},
        fields=["waiter_name", "fcm_token", "servepos_visible_profiles"],
    )

    tokens = []
    for w in waiters:
        if not w.fcm_token:
            continue
        # Check profile visibility
        visible = w.servepos_visible_profiles or ""
        if visible and pos_profile not in [p.strip() for p in visible.split(",")]:
            continue
        tokens.append(w.fcm_token)

    if not tokens:
        frappe.logger().info(f"No FCM tokens found for waiters of {pos_profile}")
        return

    # Send via FCM HTTP v1 API
    import requests as http_requests

    url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    guest_name = call_doc.get("guest_name", "")
    body_text = f"Guest at {table_name} needs assistance"
    if guest_name:
        body_text = f"{guest_name} at {table_name} needs assistance"

    sent = 0
    failed = 0

    for token in tokens:
        payload = {
            "message": {
                "token": token,
                "notification": {
                    "title": f"New Call — {table_name}",
                    "body": body_text,
                },
                "data": {
                    "type": "waiter_call",
                    "call_name": call_doc.get("name", ""),
                    "seat": table_name,
                    "restaurant": restaurant_name,
                    "pos_profile": pos_profile,
                    "guest_name": guest_name,
                },
                "android": {
                    "priority": "high",
                    "notification": {
                        "channel_id": "waiter_calls",
                        "sound": "default",
                        "default_vibrate_timings": True,
                    },
                },
            }
        }

        try:
            resp = http_requests.post(url, headers=headers, json=payload, timeout=5)
            if resp.status_code == 200:
                sent += 1
            else:
                failed += 1
                frappe.logger().warning(
                    f"FCM send failed for token {token[:20]}...: {resp.status_code} {resp.text}"
                )
        except Exception as e:
            failed += 1
            frappe.logger().warning(f"FCM send error: {e}")

    frappe.logger().info(
        f"FCM push for call {call_doc.get('name')}: sent={sent}, failed={failed}"
    )


def send_call_accepted_push(call_name, accepted_by, pos_profile):
    """Notify other waiters that a call has been accepted (so they can dismiss it)."""
    result = _get_access_token()
    if not result:
        return

    access_token, project_id = result

    # Get all other waiters' tokens
    waiters = frappe.get_all(
        "ServePOS Waiter",
        filters={"is_active": 1, "waiter_name": ["!=", accepted_by]},
        fields=["fcm_token", "servepos_visible_profiles"],
    )

    tokens = []
    for w in waiters:
        if not w.fcm_token:
            continue
        visible = w.servepos_visible_profiles or ""
        if visible and pos_profile not in [p.strip() for p in visible.split(",")]:
            continue
        tokens.append(w.fcm_token)

    if not tokens:
        return

    import requests as http_requests

    url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    for token in tokens:
        payload = {
            "message": {
                "token": token,
                "data": {
                    "type": "waiter_call_accepted",
                    "call_name": call_name,
                    "accepted_by": accepted_by,
                },
            }
        }
        try:
            http_requests.post(url, headers=headers, json=payload, timeout=5)
        except Exception:
            pass
