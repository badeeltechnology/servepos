# Guest QR Call-Waiter System — Implementation Plan

## 1. Overview

A system where guests at a resort/hotel can scan a QR code on their sun bed or seat, view restaurant menus, and call a waiter from any of the available restaurants. Waiters receive instant push notifications (Uber-style), and the first to accept gets assigned.

### User Flow

```
GUEST (Mobile Browser, No App Install):

1. Guest scans QR code on sun bed / seat
2. Opens a public web page (no login needed)
3. Sees venue branding + list of restaurants
4. Each restaurant shows a swipeable menu gallery (images)
5. Guest taps "Call Waiter" for a specific restaurant
6. Page shows "Waiter is on the way!" with live status

WAITER (Flutter App):

1. Push notification arrives instantly (FCM) — even if app is in background
2. All waiters of that restaurant see the call
3. First waiter to tap "Accept" gets assigned (others see "Already taken")
4. Waiter's screen shows: "Go to Seat Pool-B12"
5. Waiter walks to guest, taps "Mark Attended"
6. Record is saved for tracking/reporting
```

---

## 2. Current System State (As-Is Analysis)

### 2.1 ServePOS Table DocType (11 fields)

| Field | Type | Notes |
|-------|------|-------|
| table_name | Data | Required, Unique |
| room | Link -> ServePOS Room | Required |
| capacity | Int | Default: 4 |
| status | Select | Available / Occupied / Reserved / Blocked |
| current_invoice | Link -> POS Invoice | Read-only |
| is_active | Check | Default: 1 |
| shape | Select | Round / Square / Rectangle / **Bed** / **Lounge** / Bar Stool / Booth / **Umbrella** |
| pos_x | Float | Floor plan X position (0-100%) |
| pos_y | Float | Floor plan Y position (0-100%) |
| branch | Link -> Branch | Custom field via setup.py |
| servepos_visible_profiles | Small Text | Comma-separated POS Profile names |

**Key insight:** Shape already supports "Bed", "Lounge", "Umbrella" — sun beds fit naturally as Table records. No QR fields exist.

### 2.2 ServePOS Room DocType (7 fields)

| Field | Type | Notes |
|-------|------|-------|
| room_name | Data | Required, Unique |
| description | Small Text | |
| capacity | Int | Total capacity |
| is_active | Check | Default: 1 |
| floor_plan_image | Attach Image | Room layout image |
| branch | Link -> Branch | Custom field |
| servepos_visible_profiles | Small Text | Profile filtering |

### 2.3 POS Profile Custom Fields (existing)

| Field | Type | Notes |
|-------|------|-------|
| enable_kds | Check | Default: 1 |
| auto_generate_kot | Check | Default: 1 |
| auto_deduct_stock | Check | Default: 0 |
| kot_warning_minutes | Int | Default: 10 |
| kot_urgent_minutes | Int | Default: 15 |

**No branding, menu images, or guest-calling fields exist.**

### 2.4 ServePOS Waiter DocType (existing)

| Field | Type | Notes |
|-------|------|-------|
| waiter_name | Data | Required, Unique (autoname) |
| branch | Link -> Branch | |
| pin | Password | Required |
| phone | Data | |
| is_active | Check | Default: 1 |
| servepos_visible_profiles | Small Text | Profile filtering |

**No FCM token field exists.**

### 2.5 Flutter Waiter App — Current State

- **Framework:** Flutter 3.x with Provider state management
- **Package:** com.servepos.servepos_waiter
- **Firebase integration:** NONE (zero Firebase packages, no google-services.json)
- **Communication:** REST API only via http package, token auth
- **Real-time:** Polling every 10 seconds (no WebSocket)
- **QR scanning:** mobile_scanner package already present (used for device setup)
- **Unused packages:** flutter_local_notifications, audioplayers (in pubspec but not implemented)
- **Offline support:** SQLite queue for orders when offline
- **Screens:** Login, Home (Tables tab + Orders tab), Take Order
- **Auth flow:** QR scan for device config -> Waiter PIN verification

---

## 3. What We Need to Build

### 3.1 New DocType: ServePOS Waiter Call

The core record tracking each guest-to-waiter call.

| Field | Type | Notes |
|-------|------|-------|
| naming | Auto | CALL-.YYYY.-.##### |
| table | Link -> ServePOS Table | Which seat/bed (from QR) |
| pos_profile | Link -> POS Profile | Which restaurant guest chose |
| status | Select | Pending / Accepted / Attended / Expired / Cancelled |
| accepted_by | Link -> ServePOS Waiter | Who accepted |
| accepted_at | Datetime | When accepted |
| attended_at | Datetime | When marked attended |
| guest_name | Data | Optional |
| guest_token | Data | Anti-abuse session token |
| notes | Small Text | Optional guest message |
| call_time | Datetime | Auto-set on creation |

**Permissions:**
- Guest: create via whitelisted API (allow_guest=True)
- ServePOS Waiter: read, write (for accept/attend)
- ServePOS Manager: full CRUD
- ServePOS Cashier: read

### 3.2 New Child DocType: ServePOS Menu Image

Child table for POS Profile — stores menu gallery images.

| Field | Type | Notes |
|-------|------|-------|
| image | Attach Image | Menu page image |
| caption | Data | Optional label ("Drinks", "Main Course") |
| display_order | Int | Sort order in gallery |

### 3.3 New Custom Fields on POS Profile

| Field | Type | Notes |
|-------|------|-------|
| servepos_guest_section | Section Break | "Guest Calling & Branding" |
| servepos_enable_guest_calling | Check | Opt-in per restaurant |
| servepos_restaurant_display_name | Data | Friendly name shown to guests (e.g. "Beach Grill") |
| servepos_restaurant_logo | Attach Image | Logo shown on guest page |
| servepos_restaurant_description | Small Text | Short description for guests |
| servepos_guest_col_break | Column Break | |
| servepos_venue_name | Data | Venue/hotel name (shown at top of guest page) |
| servepos_venue_logo | Attach Image | Venue logo |
| servepos_menu_images | Table -> ServePOS Menu Image | Swipeable menu gallery |

### 3.4 New Custom Field on ServePOS Table

| Field | Type | Notes |
|-------|------|-------|
| qr_code_url | Data | Auto-generated URL encoded in QR (read-only) |

QR image itself is generated client-side (JS) — not stored server-side.

### 3.5 New Field on ServePOS Waiter

| Field | Type | Notes |
|-------|------|-------|
| fcm_token | Small Text | Firebase Cloud Messaging device token |

---

## 4. Anti-Abuse Strategy

Since QR codes are printed (static URLs), the URL persists in browser history. We prevent misuse with layered defenses:

| Layer | Mechanism | How It Works |
|-------|-----------|--------------|
| **Session token** | Server generates a token on page load (valid 2 hours) | Guest must present valid token to call waiter. After leaving venue and token expires, must re-scan QR physically. |
| **One active call per seat** | Server rejects if seat already has Pending/Accepted call | Prevents duplicate calls and spam |
| **Cooldown period** | 5-minute cooldown after a call is Attended | Prevents rapid repeat calls |
| **Rate limiting** | Max 3 calls per seat per hour | Hard cap on abuse |
| **Optional: WiFi check** | Guest page pings an internal-only endpoint | If venue has WiFi, can verify guest is on-premise. Graceful fallback if not. |
| **Optional: Geolocation** | Browser Geolocation API with venue coordinates | If guest grants permission, validate within venue radius. Not a hard requirement — supplementary. |

### Token Flow

```
1. Guest scans QR -> opens /call-waiter/POOL-B12
2. Page loads -> JS calls get_guest_session(seat_code)
3. Server creates ServePOS Guest Session:
   - seat_code, token (random UUID), expires_at (now + 2hrs)
   - Returns token to browser
4. Token stored in sessionStorage (not localStorage — clears on tab close)
5. "Call Waiter" button sends: create_waiter_call(seat_code, pos_profile, token)
6. Server validates: token exists, not expired, matches seat_code
7. If invalid -> "Please scan the QR code again"
```

---

## 5. Real-Time: Firebase Cloud Messaging (FCM)

### Why FCM

- Instant delivery (sub-second) vs polling (10-second delay)
- Works when app is in background or screen is off
- Battery efficient (no constant polling for calls)
- Free tier handles millions of messages/month
- Industry standard for mobile push notifications

### Setup Required

#### 5.1 Firebase Project Setup
1. Create Firebase project in Firebase Console
2. Add Android app (com.servepos.servepos_waiter)
3. Download google-services.json -> android/app/
4. Add iOS app (if needed) -> GoogleService-Info.plist
5. Generate Firebase Admin SDK service account key (for Python backend)

#### 5.2 Flutter App Changes
```yaml
# New dependencies in pubspec.yaml
firebase_core: ^3.x
firebase_messaging: ^15.x
```

```
android/app/build.gradle.kts:
  + apply plugin: 'com.google.gms.google-services'
  + implementation 'com.google.firebase:firebase-messaging'

android/build.gradle.kts:
  + classpath 'com.google.gms:google-services:4.4.x'
```

#### 5.3 Python Backend
```
# New pip dependency
firebase-admin

# Or use FCM HTTP v1 API directly (no extra package needed):
POST https://fcm.googleapis.com/v1/projects/{project}/messages:send
Authorization: Bearer {oauth2_token}
```

### FCM Flow

```
1. Waiter logs into Flutter app
2. App requests FCM token from Firebase
3. App sends token to backend: register_fcm_token(waiter_name, token)
4. Token stored on ServePOS Waiter record

5. Guest calls waiter for "Beach Grill" (pos_profile)
6. Backend creates ServePOS Waiter Call (status=Pending)
7. Backend queries: all active waiters where servepos_visible_profiles includes this pos_profile
8. Backend sends FCM push to all their fcm_tokens:
   {
     "notification": {
       "title": "New Call - Pool B-12",
       "body": "Guest at Pool B-12 needs assistance"
     },
     "data": {
       "type": "waiter_call",
       "call_name": "CALL-2026-00042",
       "seat": "Pool B-12",
       "restaurant": "Beach Grill"
     }
   }
9. All waiters receive push instantly
10. First to tap "Accept" wins (atomic server-side check)
11. Backend sends another FCM to other waiters: "Call already accepted by Ahmed"
```

---

## 6. Guest-Facing Web Page

### 6.1 Technology

Built as a **public React route** within the existing ServePos frontend:
- Route: `/pos/call-waiter/:seatCode`
- No login required
- Mobile-first, responsive design
- Venue + restaurant branding
- Swipeable image gallery (lightweight carousel)

### 6.2 Page Layout (Mobile)

```
+----------------------------------+
|  [Venue Logo]  Venue Name        |
|  --------------------------------|
|  Seat: Pool B-12                 |
|  ================================|
|                                  |
|  +----------------------------+  |
|  | [Restaurant Logo]          |  |
|  | Beach Grill                |  |
|  | "Fresh seafood & grills"   |  |
|  |                            |  |
|  | [<] Menu Image 1/3  [>]   |  |
|  | +------------------------+ |  |
|  | |                        | |  |
|  | |   (Swipeable gallery)  | |  |
|  | |                        | |  |
|  | +------------------------+ |  |
|  | o  o  o  (dots indicator) |  |
|  |                            |  |
|  |  [ Call Waiter ]           |  |
|  +----------------------------+  |
|                                  |
|  +----------------------------+  |
|  | [Restaurant Logo]          |  |
|  | Pool Bar                   |  |
|  | "Cocktails & refreshments" |  |
|  |                            |  |
|  | [<] Menu Image 1/2  [>]   |  |
|  | +------------------------+ |  |
|  | |   (Swipeable gallery)  | |  |
|  | +------------------------+ |  |
|  |                            |  |
|  |  [ Call Waiter ]           |  |
|  +----------------------------+  |
|                                  |
+----------------------------------+
```

### 6.3 After Calling

```
+----------------------------------+
|  [Venue Logo]  Venue Name        |
|  --------------------------------|
|  Seat: Pool B-12                 |
|  ================================|
|                                  |
|  +----------------------------+  |
|  |                            |  |
|  |    Waiter is on the way!   |  |
|  |                            |  |
|  |    Beach Grill             |  |
|  |    Called at 2:34 PM       |  |
|  |                            |  |
|  |    (animated indicator)    |  |
|  |                            |  |
|  |  [ Cancel Call ]           |  |
|  +----------------------------+  |
|                                  |
+----------------------------------+
```

Page polls every 5 seconds to show status updates (Accepted -> "Ahmed is coming to you!").

---

## 7. Flutter App Changes

### 7.1 New Provider: CallsProvider

```dart
class CallsProvider extends ChangeNotifier {
  List<WaiterCall> pendingCalls = [];
  List<WaiterCall> myCalls = [];  // Accepted by this waiter

  // FCM handles push -> this provider handles state
  void onNewCall(WaiterCall call);        // From FCM data
  Future<bool> acceptCall(String name);    // POST to backend
  Future<void> markAttended(String name);  // POST to backend
  Future<void> loadActiveCalls();          // GET from backend
}
```

### 7.2 New Screen: Call Alert (Overlay/Dialog)

When FCM push arrives while app is in foreground:
- Full-screen alert dialog with sound + vibration
- Shows: Seat name, Restaurant name, Time
- Buttons: [Accept] [Dismiss]

### 7.3 New Screen: Active Call View

After accepting:
- Large seat identifier: "Go to Pool B-12"
- Restaurant name
- Call time + elapsed time
- [Mark Attended] button
- History of past attended calls

### 7.4 New Tab: "Calls" in Bottom Navigation

```
Bottom Nav: [Tables] [Calls] [Orders]
                       ^
                   NEW TAB
```

Calls tab shows:
- Incoming calls (Pending) — with Accept button
- My active calls (Accepted) — with Mark Attended button
- Recent history (Attended) — last 24hrs

### 7.5 FCM Integration

```dart
// In main.dart or a dedicated service
FirebaseMessaging.onMessage.listen((message) {
  // Foreground: show in-app alert
  if (message.data['type'] == 'waiter_call') {
    callsProvider.onNewCall(WaiterCall.fromFcm(message.data));
    // Play sound, vibrate
  }
});

FirebaseMessaging.onMessageOpenedApp.listen((message) {
  // User tapped notification from background -> navigate to Calls tab
});

FirebaseMessaging.onBackgroundMessage(_backgroundHandler);
// Shows system notification when app is in background
```

---

## 8. Backend APIs

### 8.1 Guest APIs (allow_guest=True)

```python
@frappe.whitelist(allow_guest=True)
def get_guest_session(seat_code):
    """Create/return a session token for this seat.
    Token valid for 2 hours. Returns seat info + available restaurants."""
    # Validate seat exists
    # Create or reuse unexpired session
    # Return: { token, seat_name, restaurants: [...] }

@frappe.whitelist(allow_guest=True)
def get_restaurants_for_seat(seat_code):
    """Get all restaurants (POS Profiles) with guest calling enabled.
    Returns restaurant name, logo, description, menu images."""
    # Filter: servepos_enable_guest_calling = 1
    # Include: menu_images child table
    # Return list of restaurant cards

@frappe.whitelist(allow_guest=True)
def create_waiter_call(seat_code, pos_profile, token, guest_name=None, notes=None):
    """Create a waiter call request.
    Validates: token, no active call for seat, cooldown period."""
    # Validate token
    # Check no active call for this seat
    # Check cooldown
    # Create ServePOS Waiter Call (status=Pending)
    # Send FCM to all waiters of this pos_profile
    # Return call record

@frappe.whitelist(allow_guest=True)
def get_call_status(call_name, token):
    """Guest polls this to see if waiter accepted."""
    # Return: status, accepted_by (waiter name)
```

### 8.2 Waiter APIs (authenticated)

```python
@frappe.whitelist()
def get_active_calls(pos_profile):
    """Get all Pending calls for this restaurant (for Calls tab)."""

@frappe.whitelist()
def accept_waiter_call(call_name, waiter_name):
    """Atomic accept — first waiter wins.
    Uses DB-level WHERE status='Pending' to prevent race conditions."""
    # UPDATE SET status='Accepted', accepted_by=waiter
    #   WHERE name=call_name AND status='Pending'
    # If 0 rows updated -> already taken
    # Send FCM to other waiters: "Already accepted by X"
    # Send update to guest page (status change)

@frappe.whitelist()
def mark_call_attended(call_name, waiter_name):
    """Mark that waiter has met the guest."""
    # Validate: call is Accepted by this waiter
    # Update status=Attended, attended_at=now

@frappe.whitelist()
def register_fcm_token(waiter_name, fcm_token):
    """Store/update FCM token for push notifications."""
```

### 8.3 FCM Send Utility

```python
def send_fcm_to_waiters(pos_profile, call_doc):
    """Send FCM push to all active waiters of this restaurant."""
    # Get all active waiters with matching pos_profile
    # Filter to those with non-empty fcm_token
    # Send FCM multicast message
    # Use firebase-admin SDK or FCM HTTP v1 API
```

---

## 9. QR Code Generation

### 9.1 Management Dashboard Integration

Built into the RestaurantSetup or Tables page in React frontend:

- **Per-table "Generate QR" button** — generates QR encoding `https://{site}/pos/call-waiter/{table_name}`
- **QR Preview** — shows generated QR with seat label below
- **Download PNG** — single QR for printing
- **Bulk Generate** — select multiple tables/rooms -> generate a printable PDF sheet with all QRs + labels
- Uses `qrcode.react` or similar JS library (client-side generation)

### 9.2 QR Content Format

```
https://{site_url}/pos/call-waiter/{table_name}

Example: https://resort.example.com/pos/call-waiter/Pool-B12
```

The table_name is URL-safe (already unique in the system). No need for separate QR codes per restaurant — the guest page shows all restaurants.

### 9.3 Printable Output

Each QR label includes:
- QR code image (large, scannable)
- Seat/table name in human-readable text below
- Optional: venue logo at top
- Size: optimized for printing on waterproof stickers/cards

---

## 10. Implementation Phases

### Phase 1: Backend Foundation -- DONE
- [x] Create ServePOS Waiter Call DocType
- [x] Create ServePOS Menu Image child DocType
- [x] Add custom fields to POS Profile (branding, guest calling, menu images)
- [x] Add fcm_token field to ServePOS Waiter
- [x] Implement guest APIs (get_guest_session, get_restaurants, create_call, get_status, cancel_call)
- [x] Implement waiter APIs (get_active_calls, accept_call, mark_attended, get_my_active_calls, get_call_history)
- [x] Implement anti-abuse (token, one-active-per-seat, cooldown, rate limit)
- [x] Auto-expire stale calls via scheduler (every 5 minutes)

### Phase 2: FCM Integration -- DONE
- [ ] Create Firebase project (manual step — Firebase Console)
- [ ] Download google-services.json (manual step — Firebase Console)
- [ ] Configure site_config.json with FCM credentials (manual step)
- [x] Backend: FCM send utility using HTTP v1 API (servepos/api/fcm.py)
- [x] Backend: register_fcm_token API
- [x] Backend: Send push on waiter call creation
- [x] Backend: Send "already accepted" push to other waiters

### Phase 3: Guest Web Page (React) -- DONE
- [x] Add public route /call-waiter/:seatCode (GuestApp.tsx)
- [x] Venue + restaurant branding layout
- [x] Swipeable menu image gallery (ImageGallery.tsx with touch, zoom, dots)
- [x] "Call Waiter" button with token-based auth
- [x] Live status polling every 3 seconds (waiter on the way, etc.)
- [x] Cancel call option
- [x] Mobile-responsive, attractive UI

### Phase 4: QR Code Generation (React) -- DONE
- [x] Add QR generation to Tables management page (RestaurantSetup.tsx)
- [x] Per-table QR preview + download PNG (QRGenerator.tsx)
- [x] Bulk QR print page for all tables (BulkQRGenerator)
- [x] QR includes seat label text + "Scan to call waiter"
- [x] Print option per QR code

### Phase 5: Flutter App — FCM + Calls -- DONE
- [x] Add firebase_core, firebase_messaging to pubspec
- [x] Android gradle configuration for Google Services plugin
- [ ] Add google-services.json to android/app/ (manual step — Firebase Console)
- [x] FCM token registration on login (in HomeScreen._setupFCM)
- [x] Foreground notification handler (in-app IncomingCallAlert overlay)
- [x] Background notification handler (system notification via _firebaseMessagingBackgroundHandler)
- [x] New CallsProvider for state management (with 5-second polling)
- [x] New "Calls" tab in bottom navigation (3 tabs: Tables, Calls, Orders)
- [x] Call alert dialog (Accept/Dismiss) — full-screen animated overlay
- [x] Active call view ("Go to Seat X" + Mark Attended)
- [x] Call history (today's history)
- [x] WaiterCall model + API methods in erpnext_client.dart

### Phase 6: Polish & Anti-Abuse -- PARTIALLY DONE
- [x] Token expiry enforcement (2-hour sessions via Frappe cache)
- [x] Cooldown period enforcement (5 minutes after Attended)
- [x] Rate limiting (3 calls per seat per hour)
- [ ] Optional WiFi check (future enhancement)
- [ ] Optional geolocation check (future enhancement)
- [x] Call expiry (auto-expire Pending calls after 10 minutes via scheduler)
- [ ] Reporting: call metrics in Reports page (future enhancement)

---

## 11. File Changes Summary

### Backend (servepos/)

| File | Change |
|------|--------|
| servepos/doctype/servepos_waiter_call/ | NEW DocType |
| servepos/doctype/servepos_menu_image/ | NEW child DocType |
| servepos/api/guest.py | NEW — guest-facing APIs |
| servepos/api/waiter_call.py | NEW — waiter call accept/attend APIs |
| servepos/api/fcm.py | NEW — FCM send utility |
| servepos/setup.py | MODIFY — add new custom fields |
| servepos/hooks.py | MODIFY — add guest page route, fixtures |

### Frontend (frontend/src/)

| File | Change |
|------|--------|
| pages/CallWaiter.tsx | NEW — guest-facing page |
| pages/RestaurantSetup.tsx | MODIFY — add QR generation |
| components/QRGenerator.tsx | NEW — QR generation + download |
| components/MenuGallery.tsx | NEW — swipeable image carousel |
| App.tsx | MODIFY — add public route |

### Flutter App (Waiter App/lib/)

| File | Change |
|------|--------|
| pubspec.yaml | MODIFY — add firebase packages |
| android/app/build.gradle.kts | MODIFY — add google-services plugin |
| android/build.gradle.kts | MODIFY — add google-services classpath |
| android/app/google-services.json | NEW — Firebase config |
| lib/main.dart | MODIFY — Firebase init, FCM setup |
| lib/providers/calls_provider.dart | NEW — call state management |
| lib/screens/calls_screen.dart | NEW — Calls tab |
| lib/screens/call_alert_dialog.dart | NEW — incoming call overlay |
| lib/api/erpnext_client.dart | MODIFY — add call APIs |
| lib/models/models.dart | MODIFY — add WaiterCall model |

---

## 12. Open Questions

1. **Call expiry time:** How long should a Pending call wait before auto-expiring? Suggested: 10 minutes.
2. **Multiple simultaneous calls:** Can a guest call waiters from two different restaurants at once? Suggested: Yes, since they're independent restaurants.
3. **Waiter capacity:** Can a waiter accept multiple calls simultaneously? Suggested: Yes, with a reasonable cap (e.g., 3 active).
4. **Guest feedback:** After attended, should guest be able to rate the service? (Future enhancement)
5. **Call history retention:** How long to keep call records? Suggested: indefinite (for reporting).
6. **iOS support:** Does the Flutter app need iOS push notifications too, or Android only for now?
