"""
ServePOS Settings API
Manage app-level settings like FCM credentials.
"""
import frappe
from frappe import _
import json


@frappe.whitelist()
def get_fcm_status():
    """Check if FCM is configured and return status (no secrets exposed)."""
    if "System Manager" not in frappe.get_roles():
        frappe.throw(_("Only System Manager can access FCM settings"))

    creds_file = frappe.conf.get("servepos_fcm_credentials_file")
    creds_json = frappe.conf.get("servepos_fcm_credentials")

    configured = bool(creds_file or creds_json)
    project_id = ""

    if creds_json:
        if isinstance(creds_json, str):
            try:
                creds_json = json.loads(creds_json)
            except (json.JSONDecodeError, TypeError):
                pass
        if isinstance(creds_json, dict):
            project_id = creds_json.get("project_id", "")

    if creds_file:
        try:
            with open(creds_file) as f:
                data = json.load(f)
                project_id = data.get("project_id", "")
        except Exception:
            pass

    # Check if google-auth is installed
    google_auth_installed = False
    try:
        import google.auth  # noqa: F401
        google_auth_installed = True
    except ImportError:
        pass

    return {
        "configured": configured,
        "project_id": project_id,
        "source": "file" if creds_file else ("inline" if creds_json else "none"),
        "google_auth_installed": google_auth_installed,
    }


@frappe.whitelist()
def save_fcm_credentials(credentials_json):
    """Save FCM service account credentials to site_config.json."""
    if "System Manager" not in frappe.get_roles():
        frappe.throw(_("Only System Manager can modify FCM settings"))

    if not credentials_json:
        frappe.throw(_("Credentials JSON is required"))

    # Parse and validate
    if isinstance(credentials_json, str):
        try:
            creds = json.loads(credentials_json)
        except json.JSONDecodeError:
            frappe.throw(_("Invalid JSON format"))
    else:
        creds = credentials_json

    # Validate required fields
    required_fields = ["type", "project_id", "private_key", "client_email"]
    missing = [f for f in required_fields if f not in creds]
    if missing:
        frappe.throw(
            _("Invalid service account JSON. Missing fields: {0}").format(", ".join(missing))
        )

    if creds.get("type") != "service_account":
        frappe.throw(_("Invalid credentials type. Expected 'service_account'."))

    # Save to site_config.json
    frappe.conf.servepos_fcm_credentials = creds
    site_config_path = frappe.get_site_path("site_config.json")

    with open(site_config_path) as f:
        site_config = json.load(f)

    site_config["servepos_fcm_credentials"] = creds
    # Remove file path reference if it exists (inline takes precedence)
    site_config.pop("servepos_fcm_credentials_file", None)

    with open(site_config_path, "w") as f:
        json.dump(site_config, f, indent=1, sort_keys=True)

    return {
        "success": True,
        "project_id": creds.get("project_id", ""),
    }


@frappe.whitelist()
def remove_fcm_credentials():
    """Remove FCM credentials from site_config.json."""
    if "System Manager" not in frappe.get_roles():
        frappe.throw(_("Only System Manager can modify FCM settings"))

    site_config_path = frappe.get_site_path("site_config.json")

    with open(site_config_path) as f:
        site_config = json.load(f)

    site_config.pop("servepos_fcm_credentials", None)
    site_config.pop("servepos_fcm_credentials_file", None)

    with open(site_config_path, "w") as f:
        json.dump(site_config, f, indent=1, sort_keys=True)

    # Clear from runtime config
    frappe.conf.pop("servepos_fcm_credentials", None)
    frappe.conf.pop("servepos_fcm_credentials_file", None)

    return {"success": True}


@frappe.whitelist()
def test_fcm_connection():
    """Test if FCM credentials work by getting an access token."""
    if "System Manager" not in frappe.get_roles():
        frappe.throw(_("Only System Manager can test FCM"))

    from servepos.api.fcm import _get_access_token

    result = _get_access_token()
    if result:
        _, project_id = result
        return {"success": True, "project_id": project_id}
    else:
        return {"success": False, "error": "Failed to get access token. Check credentials and google-auth installation."}
