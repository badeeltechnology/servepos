"""Arabic for menu items: the Translate buttons next to the Arabic name and description.

The admin picks the service in Settings (ServePOS Translation Settings): Claude (Anthropic),
OpenAI or Google Translate, with their own API key. Claude and OpenAI are told to write item
names the way Gulf menus do, sounding out international names (Flat White: فلات وايت) and
translating plain words (Chicken Caesar Salad: سلطة سيزر بالدجاج); Google translates meaning.
"""

import frappe
import requests
from frappe import _

from servepos.api.admin import _assert

SETTINGS = "ServePOS Translation Settings"
PROVIDERS = ["Claude (Anthropic)", "OpenAI", "Google Translate"]
DEFAULT_MODEL = {"Claude (Anthropic)": "claude-haiku-5-5", "OpenAI": "gpt-4o-mini"}
TIMEOUT = 20
MAX_LEN = 2000

PROMPTS = {
	"name": (
		"You write restaurant and cafe menus in Arabic for the Gulf (Qatar, Oman, the UAE). "
		"Give the Arabic menu name for the item below, the way Gulf menus print it: sound out "
		"international and brand-like names in Arabic letters (Flat White: فلات وايت, Cappuccino: "
		"كابتشينو, Tiramisu: تيراميسو) and translate plain descriptive words (Chicken Caesar Salad: "
		"سلطة سيزر بالدجاج, Orange Juice: عصير برتقال). Keep sizes and numbers. "
		"Reply with the Arabic name only: no quotes, no notes, no English."
	),
	"description": (
		"You write restaurant and cafe menus in Arabic for the Gulf. Translate the menu description "
		"below into natural Modern Standard Arabic as it would appear on a Gulf menu. Keep dish and "
		"drink names the way Gulf menus write them. Reply with the Arabic text only: no quotes, "
		"no notes, no English."
	),
}


@frappe.whitelist()
def get_settings():
	"""For the Settings page: the provider and whether a key is saved (the key itself never leaves the server)."""
	_assert()
	doc = frappe.get_single(SETTINGS)
	return {
		"provider": doc.provider or "",
		"model": doc.model or "",
		"has_key": bool(doc.get_password("api_key", raise_exception=False)),
		"providers": PROVIDERS,
		"default_model": DEFAULT_MODEL,
	}


@frappe.whitelist(methods=["POST"])
def save_settings(provider=None, api_key=None, model=None):
	"""Save the provider and model; the key is replaced only when a new one is given."""
	_assert()
	if provider and provider not in PROVIDERS:
		frappe.throw(_("Unknown translation service"))
	doc = frappe.get_single(SETTINGS)
	doc.provider = provider or ""
	doc.model = (model or "").strip()
	if api_key and api_key.strip():
		doc.api_key = api_key.strip()
	doc.save()
	return get_settings()


@frappe.whitelist(methods=["POST"])
def to_arabic(text, kind="name", category=None):
	"""Arabic for one menu item name or description."""
	_assert()
	text = (text or "").strip()
	if not text:
		frappe.throw(_("Type the English text first"))
	if len(text) > MAX_LEN:
		frappe.throw(_("The text is too long to translate (over {0} characters)").format(MAX_LEN))
	kind = "description" if kind == "description" else "name"
	doc = frappe.get_single(SETTINGS)
	key = doc.get_password("api_key", raise_exception=False)
	if not doc.provider or not key:
		frappe.throw(_("Translation is not set up yet. Choose a service and add its API key in Settings."), title=_("Not set up"))
	model = doc.model or DEFAULT_MODEL.get(doc.provider)
	source = text if not category or kind != "name" else f"{text}\n(Menu category: {category})"
	try:
		if doc.provider == "Claude (Anthropic)":
			out = _claude(key, model, PROMPTS[kind], source)
		elif doc.provider == "OpenAI":
			out = _openai(key, model, PROMPTS[kind], source)
		else:
			out = _google(key, text)
	except requests.Timeout:
		frappe.throw(_("{0} did not answer in time. Try again.").format(doc.provider))
	except requests.RequestException:
		frappe.throw(_("Could not reach {0}. Check the server's internet connection.").format(doc.provider))
	return {"text": _clean(out, kind), "provider": doc.provider}


def _check(r, provider):
	if r.status_code in (401, 403):
		frappe.throw(_("{0} refused the API key. Check it in Settings.").format(provider))
	if r.status_code == 429:
		frappe.throw(_("{0} is limiting requests right now. Try again in a minute.").format(provider))
	if r.status_code >= 400:
		detail = ""
		try:
			body = r.json()
			detail = (body.get("error") or {}).get("message") if isinstance(body.get("error"), dict) else body.get("error")
		except Exception:
			pass
		frappe.log_error(title=f"ServePOS translation: {provider} {r.status_code}", message=r.text[:2000])
		frappe.throw(_("{0} could not translate this: {1}").format(provider, detail or r.status_code))
	return r.json()


def _claude(key, model, prompt, text):
	r = requests.post(
		"https://api.anthropic.com/v1/messages",
		headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
		json={"model": model, "max_tokens": 400, "system": prompt, "messages": [{"role": "user", "content": text}]},
		timeout=TIMEOUT,
	)
	body = _check(r, "Claude (Anthropic)")
	return "".join(b.get("text", "") for b in body.get("content", []) if b.get("type") == "text")


def _openai(key, model, prompt, text):
	r = requests.post(
		"https://api.openai.com/v1/chat/completions",
		headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
		json={"model": model, "messages": [{"role": "system", "content": prompt}, {"role": "user", "content": text}], "temperature": 0.2},
		timeout=TIMEOUT,
	)
	body = _check(r, "OpenAI")
	return ((body.get("choices") or [{}])[0].get("message") or {}).get("content") or ""


def _google(key, text):
	r = requests.post(
		"https://translation.googleapis.com/language/translate/v2",
		params={"key": key},
		json={"q": text, "source": "en", "target": "ar", "format": "text"},
		timeout=TIMEOUT,
	)
	body = _check(r, "Google Translate")
	return ((body.get("data") or {}).get("translations") or [{}])[0].get("translatedText") or ""


QUOTES = "\"'`\u201c\u201d\u00ab\u00bb"


def _clean(out, kind):
	out = (out or "").strip()
	if kind == "name":
		# a name is one line; models sometimes add a note below it
		out = next((line.strip() for line in out.splitlines() if line.strip()), "")
	out = out.strip(QUOTES).strip()
	if not out:
		frappe.throw(_("The service returned no Arabic text. Try again."))
	return out
