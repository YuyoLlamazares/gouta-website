# Wiring your iPhone to the twin

Your phone is the capture device. The twin is the thing that files, remembers,
and drafts. All of it runs through one endpoint:

```
POST https://<your-host>/api/capture
Authorization: Bearer <TWIN_TOKEN>
Content-Type: application/json

{ "body": "<text>", "kind": "note", "source": "shortcut" }
```

Everything below is a different way of hitting that endpoint without opening an app.

---

## 0. Install the app to your home screen

Safari → your twin's URL → Share → **Add to Home Screen**.

It launches without browser chrome, keeps you logged in, and caches the shell so
it opens instantly. Do this in **Safari** — Chrome on iOS cannot install PWAs.

---

## 1. "Hey Siri, tell my twin" — the one that matters most

The whole point: capture a thought while walking, without looking at a screen.

1. Shortcuts app → **+** → rename it **Tell my twin**
   (the name *is* the Siri phrase, so pick something you can say naturally).
2. Add **Dictate Text**. Set *Stop Listening* → **After Pause**.
3. Add **Get Contents of URL**:
   - **URL:** `https://<your-host>/api/capture`
   - **Method:** `POST`
   - **Headers:** `Authorization` → `Bearer <TWIN_TOKEN>`
   - **Request Body:** `JSON`
     - `body` → *Text* → insert the **Dictated Text** variable
     - `kind` → *Text* → `note`
     - `source` → *Text* → `siri`
4. Add **Get Dictionary Value**, key `summary`, then **Show Notification** with it.
   You hear what your twin understood, which is how you catch it misfiling things.

Now: *"Hey Siri, tell my twin"* → speak → it is captured, filed, and any
commitment inside it is already tracked.

---

## 2. Share Sheet — send anything you're looking at

1. New shortcut → **Send to Twin**.
2. Shortcut Details → enable **Show in Share Sheet**.
   Accept: *Text*, *URLs*, *Articles*, *Images*.
3. Add **Get Text from Input** (turns whatever was shared into text).
4. Same **Get Contents of URL** block as above, with `source` → `share`.

Now any article, message, or selected text is two taps from your twin's memory.

---

## 3. Back Tap — capture with the phone still in your pocket

Settings → Accessibility → Touch → **Back Tap** → **Double Tap** → *Tell my twin*.

Double-tap the back of the phone, speak, done. This is the lowest-friction
capture iOS allows, and friction is the only thing that kills a system like this.

## 4. Action Button (iPhone 15 Pro and later)

Settings → Action Button → swipe to **Shortcut** → pick *Tell my twin*.
Press and hold, speak. Same idea, one fewer gesture.

---

## 5. Your brief, every morning, without asking

Shortcuts → **Automation** → **+** → *Time of Day* → 07:00, daily,
**Run Immediately** (turn off *Notify When Run* if you want it silent).

1. **Get Contents of URL** → `GET https://<your-host>/api/brief`
   with the same `Authorization` header.
2. **Get Dictionary Value**, key `text`.
3. **Show Notification** — or **Speak Text**, if you want it read to you
   while you make coffee.

---

## 6. Lock Screen and Home Screen widgets

Long-press the Lock Screen → Customize → add a **Shortcuts** widget → *Tell my twin*.
One tap from a locked phone to a captured thought.

---

## Notifications when something needs approving

The twin queues proposals; you approve them from the app. Getting a *push* when
something lands needs Web Push, which iOS supports **only** for a PWA installed
to the Home Screen (iOS 16.4+), and it is not wired up in this repo yet.

Until it is, the reliable pattern is pull, not push: a second Time-of-Day
automation (say 09:00 and 17:00) that calls `GET /api/state`, reads
`counts.pendingProposals`, and notifies you only when it is above zero.

---

## A note on the token

The bearer token in these shortcuts is stored in plain text inside the shortcut.
Anyone with your unlocked phone can read it. That is an acceptable trade for a
personal capture endpoint — but it is why the twin cannot send anything on its
own, and why you should host it behind Tailscale rather than on the open
internet. See the README.
